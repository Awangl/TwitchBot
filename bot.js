require('dotenv').config();
const express = require('express');
const axios = require('axios');
const fs = require('fs');
const { Client, GatewayIntentBits, EmbedBuilder, ButtonBuilder, ButtonStyle, PermissionsBitField } = require('discord.js');

const app = express();
const port = process.env.PORT || 3000;

const twitchClientID = process.env.TWITCH_CLIENT_ID;
const twitchSecret = process.env.TWITCH_CLIENT_SECRET;
const discordChannelID = process.env.DISCORD_CHANNEL_ID;
const discordRoleID = process.env.DISCORD_ROLE_ID;
const gameCategoryToTrack = 'Beat Saber';

let twitchToken;
let isLive = {};
let currentCategory = {};

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

let streamers = [];

function loadStreamers() {
    try {
        const data = fs.readFileSync('streamers.json', 'utf8');
        streamers = JSON.parse(data).streamers;
    } catch (err) {
        console.error('Error reading streamers file:', err);
    }
}

function saveStreamers() {
    const data = JSON.stringify({ streamers }, null, 2);
    try {
        fs.writeFileSync('streamers.json', data, 'utf8');
    } catch (err) {
        console.error('Error writing streamers file:', err);
    }
}

function addStreamer(streamer) {
    if (!streamers.includes(streamer)) {
        streamers.push(streamer);
        saveStreamers();
    }
}

function removeStreamer(streamer) {
    const index = streamers.indexOf(streamer);
    if (index > -1) {
        streamers.splice(index, 1);
        saveStreamers();
    }
}

loadStreamers();

client.on('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
});

client.on('messageCreate', message => {
    if (message.content.startsWith('!addstreamer')) {
        if (!message.member.permissionsIn(message.channel).has(PermissionsBitField.Flags.Administrator)) {
            return message.channel.send('Добавлять и убирать стримеров могут только администраторы.');
        }
        const args = message.content.split(' ');
        const streamer = args[1];
        if (streamer) {
            addStreamer(streamer);
            message.channel.send(`Streamer ${streamer} добавлен в список.`);
        } else {
            message.channel.send('Использование: !addstreamer <имя_стримера>');
        }
    }

    if (message.content.startsWith('!removestreamer')) {
        if (!message.member.permissionsIn(message.channel).has(PermissionsBitField.Flags.Administrator)) {
            return message.channel.send('Добавлять и убирать стримеров могут только администраторы.');
        }
        const args = message.content.split(' ');
        const streamer = args[1];
        if (streamer) {
            removeStreamer(streamer);
            message.channel.send(`Streamer ${streamer} удалён из списка.`);
        } else {
            message.channel.send('Использование: !removestreamer <имя_стримера>');
        }
    }
});

client.login(process.env.DISCORD_BOT_TOKEN);

axios.post(`https://id.twitch.tv/oauth2/token?client_id=${twitchClientID}&client_secret=${twitchSecret}&grant_type=client_credentials`)
    .then(res => {
        twitchToken = res.data.access_token;
    });

function sendLiveNotification(streamer, streamTitle, gameName, viewers, thumbnailUrl) {
    let channel = client.channels.cache.get(discordChannelID);
    if (channel) {
        const embed = new EmbedBuilder()
            .setColor('#8B00FF')
            .setTitle(`${streamer} is now live on Twitch!`)
            .setURL(`https://twitch.tv/${streamer}`)
            .setDescription(streamTitle)
            .addFields(
                { name: 'Game', value: gameName, inline: true },
                { name: 'Viewers', value: viewers.toString(), inline: true }
            )
            .setImage(thumbnailUrl.replace('{width}', '400').replace('{height}', '225'))
            .setTimestamp();

        const button = new ButtonBuilder()
            .setLabel('Watch Stream')
            .setURL(`https://twitch.tv/${streamer}`)
            .setStyle(ButtonStyle.Link);

        channel.send({ embeds: [embed], components: [{ type: 1, components: [button] }], content: `<@&${discordRoleID}> ${streamer} в эфире!` });
    }
}

setInterval(() => {
    streamers.forEach(streamer => {
        axios.get(`https://api.twitch.tv/helix/streams?user_login=${streamer}`, {
            headers: {
                'Client-ID': twitchClientID,
                'Authorization': `Bearer ${twitchToken}`
            }
        }).then(res => {
            if (res.data.data.length > 0) {
                // Стрим активен
                let stream = res.data.data[0];
                if (!isLive[streamer]) {
                    // Стрим только что начался
                    isLive[streamer] = true;
                    currentCategory[streamer] = stream.game_name;
                    if (stream.game_name === gameCategoryToTrack) {
                        let utcTime = new Date().getTime();
                        sendLiveNotification(
                            streamer,
                            stream.title,
                            stream.game_name,
                            stream.viewer_count,
                            stream.thumbnail_url + '?t=' + utcTime
                        );
                    }
                } else if (currentCategory[streamer] !== stream.game_name) {
                    // Категория изменилась
                    currentCategory[streamer] = stream.game_name;
                    if (stream.game_name === gameCategoryToTrack) {
                        let utcTime = new Date().getTime();
                        sendLiveNotification(
                            streamer,
                            stream.title,
                            stream.game_name,
                            stream.viewer_count,
                            stream.thumbnail_url + '?t=' + utcTime
                        );
                    }
                }
            } else {
                // Стрим не активен
                isLive[streamer] = false;
                currentCategory[streamer] = null;
            }
        }).catch(err => {
            console.error(`Error fetching stream data for ${streamer}:`, err);
        });
    });
}, 60000);

app.get('/twitch', (req, res) => {
    if (twitchToken) {
        res.status(200).json({ connected: true });
    } else {
        res.status(500).json({ connected: false });
    }
});

app.get('/discord', (req, res) => {
    if (client.readyAt) {
        res.status(200).json({ connected: true });
    } else {
        res.status(500).json({ connected: false });
    }
});

app.get('/status', (req, res) => {
    res.status(200).json({ isLive });
});

app.get('/streamers', (req, res) => {
    res.status(200).json({ streamers });
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
