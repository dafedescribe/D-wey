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
        
        // Start daily billing + deletion + notification scheduler (runs every 24 hours)
        console.log('💰 Starting billing, notification & cleanup scheduler...')
        const billingInterval = setInterval(async () => {
            try {
                console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━')
                console.log('⏰ Running daily maintenance...')
                console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
                
                // This now includes:
                // 1. Billing active links
                // 2. Sending 6-hour expiration warnings
                // 3. Deleting links inactive for 24+ hours
                await LinkService.processDailyBilling()
                
                console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━')
                console.log('✅ Daily maintenance completed')
                console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
            } catch (error) {
                console.error('❌ Maintenance error:', error.message)
            }
        }, 24 * 60 * 60 * 1000) // 24 hours

        // Run initial billing + cleanup after 1 minute
        setTimeout(async () => {
            console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━')
            console.log('💰 Running initial maintenance check...')
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
            try {
                // This now includes:
                // 1. Billing active links
                // 2. Sending 6-hour expiration warnings  
                // 3. Deleting links inactive for 24+ hours
                await LinkService.processDailyBilling()
                
                console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━')
                console.log('✅ Initial maintenance completed')
                console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
            } catch (error) {
                console.error('❌ Initial maintenance error:', error.message)
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
        console.log('  ✅ WhatsApp notifications (deactivation, warnings, deletion)')
        console.log('  ✅ 6-hour expiration warnings')
        console.log('  ✅ Automatic inactive link deletion (24h)')
        console.log('  ✅ Coupon redemption')
        console.log('\n💰 Pricing:')
        console.log(`  - Create link: ${LinkService.PRICING.CREATE_LINK} tums`)
        console.log(`  - Daily maintenance: ${LinkService.PRICING.DAILY_MAINTENANCE} tums`)
        console.log(`  - Link info check: ${LinkService.PRICING.LINK_INFO_CHECK} tums`)
        console.log(`  - Set temporal target: ${LinkService.PRICING.SET_TEMPORAL_TARGET} tums`)
        console.log(`  - Kill temporal target: ${LinkService.PRICING.KILL_TEMPORAL_TARGET} tums`)
        console.log(`  - Reactivate link: ${LinkService.PRICING.REACTIVATE_LINK} tums`)
        console.log('\n🔔 Notification System:')
        console.log('  - Immediate: Link deactivated (low balance)')
        console.log('  - 18 hours: Warning (6 hours until deletion)')
        console.log('  - 24 hours: Final notification + deletion')
        console.log('\n🗑️ Auto-Cleanup:')
        console.log('  - Inactive links deleted after 24 hours')
        console.log('  - Click history deleted with links')
        console.log('  - Users notified at each stage')

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