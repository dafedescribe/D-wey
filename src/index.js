require('dotenv').config()
const { connectToWhatsApp } = require('./bot/connection')
const DWeyWebServer = require('./server/DWeyWebServer')
const LinkService = require('./services/linkService')

async function startApplication() {
    console.log('🚀 Starting D-Wey Link Service...')
    
    try {
        // Start WhatsApp bot
        console.log('📱 Connecting WhatsApp bot...')
        await connectToWhatsApp()
        console.log('✅ WhatsApp Bot connected!')
        
        // Start web server for redirects
        console.log('🌐 Starting web server...')
        const webServer = new DWeyWebServer()
        webServer.start()
        console.log('✅ Web server running!')
        
        // Start daily billing scheduler (runs every 24 hours)
        console.log('💰 Starting billing scheduler...')
        const billingInterval = setInterval(async () => {
            try {
                console.log('💰 Running daily billing...')
                await LinkService.processDailyBilling()
                console.log('✅ Daily billing completed')
            } catch (error) {
                console.error('❌ Billing error:', error.message)
            }
        }, 24 * 60 * 60 * 1000) // 24 hours

        // Run initial billing after 1 minute
        setTimeout(async () => {
            console.log('💰 Running initial billing check...')
            try {
                await LinkService.processDailyBilling()
                console.log('✅ Initial billing completed')
            } catch (error) {
                console.error('❌ Initial billing error:', error.message)
            }
        }, 60000) // 1 minute

        // Log startup completion
        console.log('🎉 D-Wey Link Service started successfully!')
        console.log('\n📊 Features enabled:')
        console.log('  ✅ WhatsApp link shortening')
        console.log('  ✅ Click tracking (IP + Cookie hash)')
        console.log('  ✅ Temporal target assignment')
        console.log('  ✅ Link analytics (peak time, clicks)')
        console.log('  ✅ Shared link access (creator + target)')
        console.log('  ✅ Daily maintenance billing')
        console.log('  ✅ Coupon redemption')
        console.log('\n💰 Pricing:')
        console.log(`  - Create link: ${LinkService.PRICING.CREATE_LINK} tums`)
        console.log(`  - Daily maintenance: ${LinkService.PRICING.DAILY_MAINTENANCE} tums`)
        console.log(`  - Link info check: ${LinkService.PRICING.LINK_INFO_CHECK} tums`)
        console.log(`  - Set temporal target: ${LinkService.PRICING.SET_TEMPORAL_TARGET} tums`)
        console.log(`  - Kill temporal target: ${LinkService.PRICING.KILL_TEMPORAL_TARGET} tums`)

        // Handle graceful shutdown
        const gracefulShutdown = (signal) => {
            console.log(`\n🛑 Received ${signal}, shutting down gracefully...`)
            
            // Stop the billing scheduler
            clearInterval(billingInterval)
            console.log('💰 Billing scheduler stopped')
            
            // Stop web server
            webServer.stop()
            console.log('🌐 Web server stopped')
            
            console.log('👋 Goodbye!')
            process.exit(0)
        }
        
        process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
        process.on('SIGINT', () => gracefulShutdown('SIGINT'))
        
    } catch (error) {
        console.error('❌ Failed to start application:', error)
        console.error('🔍 Error details:', error.stack)
        process.exit(1)
    }
}

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('💥 Uncaught Exception:', error.message)
    console.error('🔍 Stack trace:', error.stack)
    process.exit(1)
})

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason)
    process.exit(1)
})

startApplication()