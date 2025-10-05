const { default: makeWASocket, DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys')
const { Boom } = require('@hapi/boom')
const qrcode = require('qrcode-terminal')
const pino = require('pino')
const { handleMessage } = require('./handlers')
const { testConnection } = require('../config/database')
const { setWhatsAppSocket } = require('../webhook/paymentWebhook')
const UserService = require('../services/userService')
const LinkService = require('../services/linkService') // ADD THIS LINE

async function connectToWhatsApp() {
    // Test database connection first
    console.log('🔄 Testing database connection...')
    const dbConnected = await testConnection()
    if (!dbConnected) {
        console.error('❌ Cannot start bot without database connection')
        process.exit(1)
    }
    
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys')
    
    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: ['Email Collector Bot', 'Chrome', '1.0.0'],
        generateHighQualityLinkPreview: false
    })
    
    // Set socket for webhook notifications
    setWhatsAppSocket(sock)
    
    // SET SOCKET FOR LINK SERVICE NOTIFICATIONS - ADD THIS LINE
    LinkService.setWhatsAppSocket(sock)
    
    // Start rate limiting cleanup (every 5 minutes)
    const rateLimitCleanup = setInterval(() => {
        UserService.cleanupRateLimit()
        console.log('🧹 Rate limit storage cleaned up')
    }, 5 * 60 * 1000)
    
    // QR Code handling
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update
        
        if (qr) {
            console.log('📱 Scan this QR code with WhatsApp:')
            qrcode.generate(qr, { small: true })
        }
        
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut
            console.log('Connection closed, reconnecting:', shouldReconnect)
            
            // Clear rate limit cleanup interval
            clearInterval(rateLimitCleanup)
            
            if (shouldReconnect) connectToWhatsApp()
        } else if (connection === 'open') {
            console.log('✅ Bot connected successfully!')
            console.log('📧 Ready to collect emails and process payments')
            console.log('🎫 Coupon system enabled')
            console.log('⚡ Rate limiting active (5 req/min per user)')
            console.log('🎁 Signup bonus: 1000 tums')
            console.log('🔔 Link expiration notifications enabled')
        }
    })
    
    sock.ev.on('creds.update', saveCreds)
    sock.ev.on('messages.upsert', handleMessage(sock))
    
    return sock
}

module.exports = { connectToWhatsApp }