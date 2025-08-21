const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, makeInMemoryStore } = require('@whiskeysockets/baileys');
const fs = require('fs');
const P = require('pino');
const path = require('path');

// Load commands and config
const { handleCommand } = require('./commands');
const config = require('./config');

// Store for messages
const store = makeInMemoryStore({ logger: P().child({ level: 'silent' }) });

// Start WhatsApp bot
async function startBot() {
    console.log("🤖 Starting WhatsApp Bot...");
    console.log("👑 Owner:", config.ownerName);
    console.log("📞 Number:", config.OWNER_NUMBER);
    console.log("🤖 Bot Name:", config.BOT_NAME);
    console.log("⚡ Prefix:", config.prefix);
    console.log("─".repeat(50));
    
    const { state, saveCreds } = await useMultiFileAuthState("auth_info");
    
    const sock = makeWASocket({
        logger: P({ level: "silent" }),
        auth: state,
        printQRInTerminal: true, // This will show the actual pairing QR code
        mobile: false,
        syncFullHistory: false,
        generateHighQualityLinkPreview: true,
        markOnlineOnConnect: true,
        shouldIgnoreJid: jid => jid?.endsWith('@broadcast'),
        getMessage: async (key) => {
            return store.loadMessage(key.remoteJid, key.id) || null;
        }
    });
    
    // Bind store to socket
    store.bind(sock.ev);
    
    // Connection handling
    sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect, qr, isNewLogin } = update;
        
        if (qr) {
            console.log("─".repeat(50));
            console.log("📡 SCAN THIS QR CODE WITH YOUR WHATSAPP:");
            console.log("─".repeat(50));
            console.log("1. Open WhatsApp on your phone");
            console.log("2. Go to Settings → Linked Devices");
            console.log("3. Tap 'Link a Device'");
            console.log("4. Scan the QR code below");
            console.log("─".repeat(50));
            // The QR code will automatically appear here from printQRInTerminal
        }
        
        if (isNewLogin) {
            console.log("✅ New login detected - ready for pairing!");
        }
        
        if (connection === "close") {
            const shouldReconnect =
                lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log("🔌 Connection closed. Reason:", lastDisconnect?.error?.output?.statusCode);
            
            if (shouldReconnect) {
                console.log("🔄 Reconnecting in 3 seconds...");
                setTimeout(startBot, 3000);
            } else {
                console.log("❌ Cannot reconnect. Please restart the bot.");
            }
        }
        else if (connection === "open") {
            console.log("─".repeat(50));
            console.log("✅ BOT CONNECTED SUCCESSFULLY!");
            console.log("✅ Now paired with your number:", config.OWNER_NUMBER);
            console.log("🤖 Bot is ready to receive commands!");
            console.log("─".repeat(50));
        }
    });
    
    // Listen for credentials updates
    sock.ev.on("creds.update", saveCreds);
    
    // Listen for pairing events
    sock.ev.on("pairing.update", (update) => {
        if (update.code) {
            console.log("📋 Pairing code received (if applicable)");
        }
    });
    
    // Handle incoming messages
    sock.ev.on("messages.upsert", async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;
        
        // Store the message
        await store.storeMessage(msg, msg.key.remoteJid);
        
        const from = msg.key.remoteJid;
        const type = Object.keys(msg.message)[0];
        const body =
            type === "conversation" ?
            msg.message.conversation :
            type === "extendedTextMessage" ?
            msg.message.extendedTextMessage.text :
            "";
        
        // Check for command prefix
        if (!body.startsWith(config.prefix)) return;
        const args = body.slice(1).trim().split(/ +/);
        const command = args.shift().toLowerCase();
        
        // Security: Only owner can run commands
        const sender = msg.key.participant || msg.key.remoteJid;
        const senderNumber = sender.replace(/@s\.whatsapp\.net/, "");
        const isOwner = senderNumber === config.OWNER_NUMBER;
        
        console.log(`⚡ Command received: ${config.prefix}${command} from ${senderNumber}`);
        
        // Pass to command handler
        try {
            await handleCommand(sock, msg, from, command, args, {
                isOwner,
                OWNER_NAME: config.ownerName,
                OWNER_NUMBER: config.OWNER_NUMBER,
                BOT_NAME: config.BOT_NAME
            });
        } catch (err) {
            console.error("❌ Error handling command:", err);
            try {
                await sock.sendMessage(from, {
                    text: "❌ An error occurred while processing your command."
                }, { quoted: msg });
            } catch (sendError) {
                console.error("Failed to send error message:", sendError);
            }
        }
    });
    
    // Handle connection errors
    sock.ev.on("connection.update", (update) => {
        if (update.error) {
            console.error("❌ Connection error:", update.error);
        }
    });
    
    // Handle message history sync
    sock.ev.on('messaging-history.set', ({ chats, contacts, messages, isLatest }) => {
        if (isLatest) {
            console.log("✅ Message history synced successfully");
        }
    });
}

// Start the bot with error handling
async function main() {
    try {
        await startBot();
    } catch (error) {
        console.error("❌ Failed to start bot:", error);
        console.log("🔄 Restarting in 5 seconds...");
        setTimeout(main, 5000);
    }
}

// Handle process errors
process.on('uncaughtException', (error) => {
    console.error('⚠️ Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('⚠️ Unhandled Rejection at:', promise, 'reason:', reason);
});

// Start the application
console.log("🚀 Starting CypherX WhatsApp Bot...");
console.log("📅", new Date().toLocaleString());
console.log("─".repeat(50));

main();