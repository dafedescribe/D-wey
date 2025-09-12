require('dotenv').config()
const express = require('express')
const { connectToWhatsApp } = require('./bot/connection')
const { handlePaystackWebhook } = require('./webhook/paymentWebhook')

const app = express()
const PORT = process.env.PORT || 3000

// Middleware
app.use(express.json())
app.use(express.raw({ type: 'application/json' }))

// Health check endpoint
app.get('/', (req, res) => {
    res.json({ status: 'WhatsApp Email Collector Bot is running!' })
})

// Paystack webhook endpoint
app.post('/webhook/paystack', handlePaystackWebhook)

async function startApplication() {
    console.log('🚀 Starting Email Collector Bot...')
    
    try {
        // Start WhatsApp bot
        await connectToWhatsApp()
        console.log('✅ WhatsApp Bot connected!')
        
        // Start webhook server
        app.listen(PORT, () => {
            console.log(`🌐 Webhook server running on port ${PORT}`)
            console.log(`📡 Webhook URL: ${process.env.RENDER_EXTERNAL_URL || 'http://localhost:' + PORT}/webhook/paystack`)
        })
        
        // Handle graceful shutdown
        process.on('SIGTERM', () => {
            console.log('🛑 Shutting down gracefully...')
            process.exit(0)
        })
        
        process.on('SIGINT', () => {
            console.log('🛑 Shutting down gracefully...')
            process.exit(0)
        })
        
    } catch (error) {
        console.error('❌ Failed to start application:', error)
        process.exit(1)
    }
}

startApplication()