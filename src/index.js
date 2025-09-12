require('dotenv').config()
const { connectToWhatsApp } = require('./bot/connection')

async function startApplication() {
    console.log('🚀 Starting Email Collector Bot...')
    
    try {
        await connectToWhatsApp()
        console.log('✅ Email Collector Bot started successfully!')
        
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