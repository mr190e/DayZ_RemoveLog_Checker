const fs = require('fs');
const { Client, Intents, MessageEmbed, Collection } = require('discord.js');

const config = JSON.parse(fs.readFileSync('./config.json'));
const { token, channelId, logFile } = config;
let maxDistance = config.maxDistance;
const client = new Client({ intents: [Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_MESSAGES] });

let eventCollectionMap = new Map();

client.once('ready', () => {
  console.log(`Bot connected as ${client.user.tag}`);
});

client.on('messageCreate', (message) => {
  if (message.channel.id !== channelId) return;
  if (!message.content.startsWith('/set-distance')) return;

  const args = message.content.trim().split(/ +/g);
  const command = args.shift().toLowerCase();

  if (command === '/set-distance' && args.length > 0) {
    const newDistance = parseFloat(args[0]);
    if (!isNaN(newDistance) && isFinite(args[0])) {
      maxDistance = newDistance;
      message.reply(`The maximum distance has been updated to ${maxDistance}m.`);
    } else {
      message.reply(`Please provide a valid numeric value for the distance.`);
    }
  }
});

function parseLogEntry(logEntry) {
  const playerMatch = logEntry.match(/Player "(.+)" \(id=(.+) pos=<(.+)>\) removed (.+) from (.+) at <(.+)>/);
  if (!playerMatch) return null;
  const [, player, id, pos, item, from, at] = playerMatch;
  return { player, id, pos, item, from, at };
}

function sendLogMessage(logEntry) {
  const data = parseLogEntry(logEntry);
  if (!data) return;

  const coords = extractCoordinates(logEntry);
  let distance = '';
  if (coords) {
    distance = calculateDistance(...coords).toFixed(2);
  }

  const embed = new MessageEmbed()
    .setTitle('Potential FreeCamer detected')
    .addFields(
      { name: 'Player', value: data.player },
      { name: 'ID', value: data.id },
      { name: 'Player Position', value: data.pos },
      { name: 'Item', value: data.item },
      { name: 'From', value: data.from },
      { name: 'Storage Position', value: data.at },
      { name: 'from distance', value: `${distance} m` },
    );

  client.channels.fetch(channelId)
    .then((channel) => {
      const role = channel.guild.roles.cache.get(config.roleId);
      if (role) {
        channel.send({ content: role.toString(), embeds: [embed] });
      } else {
        channel.send({ embeds: [embed] });
      }
    })
    .catch((error) => console.error('Error sending log message:', error));
}

let currentSize = 0;

function extractCoordinates(text) {
  const regex = /<(\d+\.\d+),\s*(\d+\.\d+),\s*(\d+\.\d+)>/g;
  const matches = [...text.matchAll(regex)];
  if (matches.length < 2) return null;
  const coords1 = matches[0].slice(1, 4).map(Number);
  const coords2 = [matches[1][1], matches[1][3], matches[1][2]].map(Number);
  return [coords1, coords2];
}

function calculateDistance([x1, y1, z1], [x2, y2, z2]) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dz = z2 - z1;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function monitorLogFile() {
  const stats = fs.statSync(logFile);
  currentSize = stats.size;

  fs.watchFile(logFile, (curr, prev) => {
    if (curr.size < prev.size) {
      currentSize = curr.size;
      return;
    }

    const bufferSize = curr.size - currentSize;
    if (bufferSize <= 0) {
      return;
    }

    const buffer = Buffer.alloc(bufferSize);
    const fileDescriptor = fs.openSync(logFile, 'r');
    fs.readSync(fileDescriptor, buffer, 0, bufferSize, currentSize);
    fs.closeSync(fileDescriptor);

    const newContent = buffer.toString('utf-8');
    const lines = newContent.split('\n');

		lines.forEach((line) => {
		  if (line.trim() !== '' && line.includes('removed')) {
			console.log(`Processing line: ${line}`); // Debug line

			const coords = extractCoordinates(line);
			if (coords) {
			  const distance = calculateDistance(...coords).toFixed(2);
			  console.log(`Found event: ${line}`);
			  console.log(`Calculated distance: ${distance}`);
			  if (distance > maxDistance) {
				sendLogMessage(line);
			  }

			  let foundType = null;
			  for (const type of config.storageTypes) {
				const regex = new RegExp(`\\b${type}\\b`, 'i');
				if (regex.test(line)) {
				  foundType = type;
				  console.log(`Matched type: ${foundType}`); // Debug line
				  break;
				}
			  }

          if (foundType) {
            const data = parseLogEntry(line);
            if (!data) return;

            const storageTypeRegex = new RegExp(`(?<=${foundType}).+?(?= at)`, 'i');
            const fullStorageType = line.match(storageTypeRegex)?.[0].trim() || foundType; // Get full storage type from log line.

            if (!eventCollectionMap.has(data.player)) {
              eventCollectionMap.set(data.player, {
                timestamp: Date.now(),
                count: 1,
                storageType: fullStorageType, // Store full storage type.
                items: [data.item],
                timeout: setTimeout(() => {
                  sendSummaryMessage(data.player, eventCollectionMap.get(data.player));
                  eventCollectionMap.delete(data.player);
                }, 30000)
              });
            } else {
              const playerData = eventCollectionMap.get(data.player);
              clearTimeout(playerData.timeout);
              if ((Date.now() - playerData.timestamp) <= 30000) {
                playerData.count += 1;
                playerData.items.push(data.item);
                playerData.timeout = setTimeout(() => {
                  sendSummaryMessage(data.player, playerData);
                  eventCollectionMap.delete(data.player);
                }, 30000);
              } else {
                playerData.timestamp = Date.now();
                playerData.count = 1;
                playerData.items = [data.item];
                playerData.storageType = fullStorageType;
                playerData.timeout = setTimeout(() => {
                  sendSummaryMessage(data.player, playerData);
                  eventCollectionMap.delete(data.player);
                }, 30000);
              }
              eventCollectionMap.set(data.player, playerData);
            }
          }
        }
      }
    });

    currentSize = curr.size;
  });
}

function hexToDec(hexString) {
    return parseInt(hexString.replace(/^#/, ''), 16);
}

function sendSummaryMessage(player, data) {
  console.log(`Storage Type: ${data.storageType}`); // Debugging line
  console.log(`Color: ${config.storageTypeColors[data.storageType] || '#FFFFFF'}`); // Debugging line

  const embed = new MessageEmbed()
    .setTitle(`Looting Activity Detected!`)
    .setColor(config.storageTypeColors[data.storageType] || '#FFFFFF') // Default to white if the storage type color is not found.
    .addFields(
      { name: 'Player', value: player, inline: true },
      { name: 'Total items looted', value: data.count.toString(), inline: true },
      { name: 'Storage type', value: data.storageType, inline: true },
      { name: 'Items', value: data.items.join('\n'), inline: false },
    )
    .setTimestamp();

  client.channels.fetch(config.WatchStorageType_Channel)
    .then((channel) => {
      channel.send({ embeds: [embed] });
    })
    .catch((error) => console.error('Error sending summary message:', error));
}

client.login(token).then(() => {
  monitorLogFile();
});
