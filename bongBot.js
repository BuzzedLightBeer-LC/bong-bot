// Existing imports and setup
const { Client, GatewayIntentBits } = require('discord.js');
const config = require('./config.json');
require('dotenv').config();
const AWS = require('aws-sdk');

// Initialize AWS Secrets Manager
const secretsManager = new AWS.SecretsManager({ region: 'us-east-2' });

// Function to retrieve Discord Token from AWS Secrets Manager
async function getDiscordToken() {
    try {
        const data = await secretsManager.getSecretValue({ SecretId: 'BongBotSecret' }).promise();
        if (data.SecretString) {
            const secret = JSON.parse(data.SecretString);
            return secret.DISCORD_TOKEN;
        }
        throw new Error('SecretString not found in Secrets Manager');
    } catch (error) {
        console.error('Error retrieving Discord token:', error);
        throw error;
    }
}

// Initialize Discord client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildMembers
    ]
});

// Function to shuffle an array
function shuffleArray(array) {
    return array.sort(() => Math.random() - 0.5);
}

// Function to delay execution for a specified amount of time
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Function to react to the message with all emojis in random order
async function reactWithEmojis(message, startCollectorCallback) {
    try {
        const shuffledEmojis = shuffleArray([...config.emojiSet]); // Shuffle the emoji set
        for (const emoji of shuffledEmojis) {
            await message.react(emoji);

            // Start the collector immediately when the bot reacts with the correctEmoji
            if (emoji === config.correctEmoji && startCollectorCallback) {
                startCollectorCallback();
            }

            // Delay before reacting with the next emoji
            await delay(config.reactionDelayMin + Math.random() * config.reactionDelayRange);
        }
        console.log("Successfully reacted with all emojis in random order.");
    } catch (error) {
        console.error("Error reacting to the message:", error);
    }
}

// Event listener: Bot is ready
client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}`);

    // **Remove "TimeKeeper" role from all members at startup**
    try {
        const guild = client.guilds.cache.get(config.guildId); // Use your guild's ID from the config
        if (guild) {
            const members = await guild.members.fetch(); // Fetch all members in the guild
            const timeKeeperRole = guild.roles.cache.get(config.timeKeeperRole);

            if (timeKeeperRole) {
                members.forEach(async (member) => {
                    if (member.roles.cache.has(timeKeeperRole.id)) {
                        await member.roles.remove(timeKeeperRole);
                        console.log(`Removed "TimeKeeper" role from ${member.user.tag}`);
                    }
                });
            } else {
                console.error("TimeKeeper role not found. Check the 'timeKeeperRole' ID in the config file.");
            }
        } else {
            console.error("Guild not found. Check the 'guildId' in the config file.");
        }
    } catch (error) {
        console.error("Error removing TimeKeeper role at startup:", error);
    }

    if (!config.testMode) {
        scheduleHourlyBong().catch(error => console.error("Error scheduling hourly BONG:", error));
    }
});

// Function to schedule the hourly "BONG!"
async function scheduleHourlyBong() {
    try {
        while (!config.testMode) {
            const now = new Date();
            const delayTime = 3600000 - (now.getMinutes() * 60000 + now.getSeconds() * 1000 + now.getMilliseconds());
            console.log(`Next BONG! scheduled in ${delayTime / 1000} seconds.`);
            await new Promise(resolve => setTimeout(resolve, delayTime));
            await sendBongMessage();
        }
    } catch (error) {
        console.error("Error in hourly BONG scheduling:", error);
    }
}

// Function to send the "BONG!" message
async function sendBongMessage() {
    try {
        const bongChannel = await client.channels.fetch(config.bongChannel);
        if (!bongChannel) {
            console.error("BONG! channel not found. Check the 'bongChannel' ID in the config file.");
            return;
        }

        // Delete any existing "BONG!" messages
        try {
            const messages = await bongChannel.messages.fetch({ limit: 100 });
            const botMessages = messages.filter(msg => msg.author.id === client.user.id);

            for (const [, botMessage] of botMessages) {
                await botMessage.delete();
                console.log("Deleted existing BONG! message.");
            }
        } catch (error) {
            console.error("Error fetching or deleting previous messages:", error);
        }

        // Send the new "BONG!" message
        const bongMessage = await bongChannel.send(config.bongMessageContent);
        console.log("BONG! message sent.");

        let collectorStarted = false;

        // Function to start the collector
        const startCollector = () => {
            if (collectorStarted) return; // Prevent duplicate collectors
            collectorStarted = true;

            const reactedUsers = new Set();

            const collector = bongMessage.createReactionCollector({
                dispose: true,
                filter: (reaction, user) => !user.bot && reaction.emoji.name === config.correctEmoji
            });

            collector.on('collect', async (reaction, user) => {
                try {
                    if (reactedUsers.has(user.id)) {
                        console.log(`${user.tag} already reacted. Ignoring.`);
                        return;
                    }

                    const guild = reaction.message.guild;
                    const member = await guild.members.fetch(user.id);
                    if (!member) {
                        console.error("Member not found during reaction collection.");
                        return;
                    }

                    const timeKeeperRole = guild.roles.cache.get(config.timeKeeperRole);
                    if (!timeKeeperRole) {
                        console.error("TimeKeeper role not found. Check the 'timeKeeperRole' ID in the config file.");
                        return;
                    }

                    reactedUsers.add(user.id);

                    const currentTimeKeeper = guild.members.cache.find(member => member.roles.cache.has(config.timeKeeperRole));
                    const announcementsChannel = await client.channels.fetch(config.bongAnnouncementsChannel);

                    if (currentTimeKeeper?.id === member.id) {
                        await currentTimeKeeper.roles.remove(timeKeeperRole);
                        await member.roles.add(timeKeeperRole);
                        console.log(`${member.displayName} is already the TimeKeeper.`);
                        if (announcementsChannel) {
                            await announcementsChannel.send(config.alreadyTimeKeeperMessage.replace('{member}', member));
                            console.log("Announcement sent.");
                        }
                    } else {
                        if (currentTimeKeeper) {
                            await currentTimeKeeper.roles.remove(timeKeeperRole);
                            console.log(`Removed TimeKeeper role from ${currentTimeKeeper.displayName}.`);
                        }

                        await member.roles.add(timeKeeperRole);
                        console.log(`Assigned TimeKeeper role to ${member.displayName}.`);

                        if (announcementsChannel) {
                            await announcementsChannel.send(
                                config.newTimeKeeperMessage
                                    .replace('{old}', currentTimeKeeper || 'nobody')
                                    .replace('{new}', member)
                            );
                            console.log("Announcement sent.");
                        } else {
                            console.error("Announcements channel not found. Check the 'bongAnnouncementsChannel' ID in the config file.");
                        }
                    }

                    collector.stop();
                    console.log(`Stopped listening for reactions. Winner: ${member.displayName}`);
                    await bongMessage.delete();
                    console.log("BONG! message deleted.");
                } catch (error) {
                    console.error("Error handling reaction collection:", error);
                }
            });
        };

        // React to the message with emojis and start the collector as soon as the bot reacts with the correctEmoji
        await reactWithEmojis(bongMessage, startCollector);
    } catch (error) {
        console.error("Error sending BONG! message:", error);
    }
}

// Command listener for test mode
client.on('messageCreate', async (message) => {
    try {
        if (!config.testMode) return;

        const guild = message.guild;
        if (!guild) return;

        const hasAdminOrSpecificRole = config.adminRole.some(roleId => {
            const role = guild.roles.cache.get(roleId);
            return role && message.member.roles.cache.has(role.id);
        });

        if (!hasAdminOrSpecificRole) {
            console.log(`User ${message.author.tag} does not have an admin or required role.`);
            return;
        }

        if (message.content.toLowerCase() === config.testCommand) {
            console.log(`Received ${config.testCommand} command from ${message.author.tag}.`);
            await sendBongMessage();
        }
    } catch (error) {
        console.error("Error handling messageCreate event:", error);
    }
});

// Fetch the token and log in
(async () => {
    try {
        const token = await getDiscordToken();
        client.login(token);
    } catch (error) {
        console.error('Failed to start the bot:', error);
    }
})();

