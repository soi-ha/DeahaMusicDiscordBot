require('dotenv').config(); // .env 불러오기
const { Client, IntentsBitField, EmbedBuilder } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus } = require('@discordjs/voice');
const ytdl = require('ytdl-core');
const ytSearch = require('yt-search');

// 클라이언트 생성 (필요한 인텐트 활성화)
const client = new Client({
	intents: [
		IntentsBitField.Flags.Guilds, // 서버 접근
		IntentsBitField.Flags.GuildMessages, // 메시지 읽기
		IntentsBitField.Flags.MessageContent, // 메시지 내용
		IntentsBitField.Flags.GuildVoiceStates, // 음성 채널 상태
	],
});

const prefix = process.env.PREFIX;
const GUILD_ID = process.env.GUILD_ID;
const queueMap = new Map(); // 서버별 노래 대기열 저장

// 봇 로그인
client.once('ready', () => {
	console.log(`✅ 로그인 완료! ${client.user.tag} (명령어 접두사: ${prefix})`);
});

// 메시지 이벤트
client.on('messageCreate', async (message) => {
	if (message.author.bot) return; // 봇의 메시지는 무시
	if (!message.guild) return; // DM 등 무시
	if (message.guild.id !== GUILD_ID) {
		// 지정 서버 외 사용 제한
		return message.reply('❌ 이 서버에서는 사용할 수 없어요!');
	}
	if (!message.content.startsWith(prefix)) return;

	const args = message.content.slice(prefix.length).trim().split(/ +/);
	const cmd = args.shift();

	// 재생 명령어: /재생 <키워드 or URL>
	if (cmd === '재생') {
		const query = args.join(' ');
		if (!query) return message.reply('⚠️ 노래 제목이나 URL을 입력해주세요!');
		const voiceChannel = message.member.voice.channel;
		if (!voiceChannel) return message.reply('🎧 먼저 음성 채널에 들어가 주세요!');

		// URL인지 확인
		let songInfo, song;
		if (ytdl.validateURL(query)) {
			songInfo = await ytdl.getInfo(query);
			song = { title: songInfo.videoDetails.title, url: songInfo.videoDetails.video_url };
		} else {
			// 키워드 검색
			const { videos } = await ytSearch(query);
			if (!videos.length) return message.reply('😥 검색 결과가 없습니다...');
			song = { title: videos[0].title, url: videos[0].url };
		}

		// 대기열 관리
		let queue = queueMap.get(message.guild.id);
		if (!queue) {
			queue = { voiceChannel, textChannel: message.channel, player: createAudioPlayer(), songs: [] };
			queueMap.set(message.guild.id, queue);

			// 채널 조인
			const connection = joinVoiceChannel({
				channelId: voiceChannel.id,
				guildId: message.guild.id,
				adapterCreator: message.guild.voiceAdapterCreator,
			});
			queue.connection = connection;
			playSong(message.guild.id, queue.songs.shift() || song);
		} else {
			queue.songs.push(song);
			return message.reply(`✅ 🦐 ${song.title} 🦐 를 대기열에 추가했어요!`);
		}
	}

	// 스킵 명령어: /스킵
	else if (cmd === '스킵') {
		const queue = queueMap.get(message.guild.id);
		// 1) 큐가 없거나, 2) 재생 중인 노래가 없고 대기열도 비어 있으면
		if (!queue || (queue.player.state.status !== AudioPlayerStatus.Playing && queue.songs.length === 0)) {
			return message.reply('⚠️ 스킵할 노래가 없어요!');
		}
		queue.player.stop();
		return message.reply('⏭️ 노래를 스킵합니다!');
	}

	// 목록 명령어: /대기열
	else if (cmd === '대기열') {
		const queue = queueMap.get(message.guild.id);
		if (!queue || queue.songs.length === 0) {
			return message.reply('📃 대기열이 비어있어요!');
		}
		const embed = new EmbedBuilder()
			.setTitle('🎵 재생 대기열')
			.setDescription(queue.songs.map((s, i) => `${i + 1}. ${s.title}`).join('\n'))
			.setColor('#7E51F4');
		return message.channel.send({ embeds: [embed] });
	}

	// 종료 명령어: /종료
	else if (cmd === '종료') {
		const queue = queueMap.get(message.guild.id);

		// 1) 큐가 없거나,
		// 2) 재생 중인 곡이 없고(플레이어가 Playing 상태가 아니고),
		//    대기열(songs)도 비어 있으면
		if (!queue || (queue.player.state.status !== AudioPlayerStatus.Playing && queue.songs.length === 0)) {
			return message.reply('⚠️ 종료할 곡이 없어요!');
		}
		queue.player.stop();
		queue.connection.destroy();
		queueMap.delete(message.guild.id);
		return message.reply('👋 노래를 종료하고 🦐대하는 떠납니다!');
	}
});

// 곡 재생 함수
async function playSong(guildId, song) {
	const queue = queueMap.get(guildId);
	if (!song) {
		queue.connection.destroy();
		queueMap.delete(guildId);
		return;
	}
	// 스트림 생성
	const stream = ytdl(song.url, { filter: 'audioonly', highWaterMark: 1 << 25 });
	const resource = createAudioResource(stream);
	queue.player.play(resource);
	queue.connection.subscribe(queue.player);

	// 텍스트 알림
	queue.textChannel.send(`▶️ 재생: 🦐 ${song.title} 🦐`);

	// 노래 종료 후 처리
	queue.player.once(AudioPlayerStatus.Idle, () => {
		playSong(guildId, queue.songs.shift());
	});
}

// 로그인 실행
client.login(process.env.DISCORD_TOKEN);
