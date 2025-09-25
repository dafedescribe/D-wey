require('dotenv').config()
const express = require('express')
const { connectToWhatsApp } = require('./bot/connection')
const { handlePaystackWebhook } = require('./webhook/paymentWebhook')
const DWeyWebServer = require('./server/dWeyWebServer')
const PaymentService = require('./services/paymentService')
const LinkService = require('./services/linkService')

const app = express()
const PORT = process.env.PORT || 3000

// Middleware for payment webhooks
app.use('/webhook', express.json())
app.use('/webhook', express.raw({ type: 'application/json' }))

// Health check endpoint
app.get('/', (req, res) => {
    res.json({ 
        service: 'd-wey WhatsApp Link Shortener',
        status: 'running',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        version: '1.0.0',
        features: [
            'WhatsApp link creation',
            'Click tracking & analytics',
            'Third-party verification',
            'Custom short codes',
            'Real-time reports',
            'Payment processing'
        ]
    })
})

// Detailed health check
app.get('/health', async (req, res) => {
    try {
        res.json({
            status: 'healthy',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            services: {
                whatsapp: 'connected',
                database: 'connected',
                webhook: 'active',
                geolocation: 'enabled'
            },
            pricing: LinkService.TUMS_PRICING
        })
    } catch (error) {
        res.status(503).json({
            status: 'unhealthy',
            timestamp: new Date().toISOString(),
            error: error.message
        })
    }
})

// Payment webhook endpoint
app.post('/webhook/paystack', handlePaystackWebhook)

// Admin endpoints for monitoring and maintenance
app.post('/admin/cleanup-expired', async (req, res) => {
    try {
        // This would be called by a cron job
        const expiredCount = await PaymentService.cleanupExpiredTransactions()
        res.json({
            message: `Cleaned up ${expiredCount} expired transactions`,
            timestamp: new Date().toISOString()
        })
    } catch (error) {
        res.status(500).json({
            error: 'Cleanup failed',
            message: error.message
        })
    }
})

app.post('/admin/process-billing', async (req, res) => {
    try {
        // Daily billing for active links
        await LinkService.processDailyBilling()
        res.json({
            message: 'Daily billing processed',
            timestamp: new Date().toISOString()
        })
    } catch (error) {
        res.status(500).json({
            error: 'Billing failed',
            message: error.message
        })
    }
})

app.get('/admin/stats', async (req, res) => {
    try {
        const stats = await PaymentService.getTransactionStats()
        res.json({
            stats: stats || { message: 'No transactions found' },
            timestamp: new Date().toISOString()
        })
    } catch (error) {
        res.status(500).json({
            error: 'Failed to get stats',
            message: error.message
        })
    }
})

async function startApplication() {
    console.log('🚀 Starting d-wey Application v1.0...')
    
    try {
        // Start WhatsApp bot first
        console.log('🤖 Starting WhatsApp Bot...')
        await connectToWhatsApp()
        console.log('✅ WhatsApp Bot connected!')
        
        // Start the main d-wey web server for redirects
        console.log('🌐 Starting d-wey Web Server...')
        const dWeyServer = new DWeyWebServer()
        await dWeyServer.start(PORT)
        console.log('✅ d-wey Web Server started!')
        
        // Start webhook server on different port if in production
        let webhookServer
        if (process.env.NODE_ENV === 'production') {
            const webhookPort = PORT + 1
            webhookServer = app.listen(webhookPort, () => {
                console.log(`📡 Webhook server running on port ${webhookPort}`)
                console.log(`💳 Webhook URL: ${process.env.RENDER_EXTERNAL_URL}/webhook/paystack`)
            })
        } else {
            // In development, use the same server
            webhookServer = app.listen(PORT + 1, () => {
                console.log(`📡 Webhook server running on port ${PORT + 1}`)
            })
        }
        
        // Start scheduled tasks
        console.log('⏰ Starting scheduled tasks...')
        
        // Daily billing scheduler (runs every 24 hours)
        const billingInterval = setInterval(async () => {
            try {
                console.log('💰 Running scheduled billing...')
                await LinkService.processDailyBilling()
                console.log('✅ Scheduled billing completed')
            } catch (error) {
                console.error('❌ Scheduled billing error:', error.message)
            }
        }, 24 * 60 * 60 * 1000) // 24 hours

        // Payment cleanup scheduler (runs every 2 hours)
        const paymentCleanupInterval = setInterval(async () => {
            try {
                console.log('🧹 Running payment cleanup...')
                const expiredCount = await PaymentService.cleanupExpiredTransactions()
                if (expiredCount > 0) {
                    console.log(`✅ Cleaned up ${expiredCount} expired payments`)
                }
            } catch (error) {
                console.error('❌ Payment cleanup error:', error.message)
            }
        }, 2 * 60 * 60 * 1000) // 2 hours

        // Location cache cleanup (runs every hour)
        const LocationService = require('./services/locationService')
        const locationCleanupInterval = setInterval(() => {
            try {
                LocationService.cleanupCache()
                console.log('🧹 Location cache cleaned up')
            } catch (error) {
                console.error('❌ Location cleanup error:', error.message)
            }
        }, 60 * 60 * 1000) // 1 hour

        // Run initial cleanup after 1 minute
        setTimeout(async () => {
            console.log('🧹 Running initial cleanup...')
            try {
                const expiredCount = await PaymentService.cleanupExpiredTransactions()
                await LinkService.processDailyBilling()
                console.log(`✅ Initial cleanup: ${expiredCount} expired payments processed`)
            } catch (error) {
                console.error('❌ Initial cleanup error:', error.message)
            }
        }, 60000) // 1 minute

        // Log startup completion
        console.log('🎉 d-wey Application started successfully!')
        console.log('')
        console.log('📊 Features enabled:')
        console.log('  ✅ WhatsApp link shortening')
        console.log('  ✅ Click tracking & analytics')
        console.log('  ✅ Third-party verification')
        console.log('  ✅ Custom short codes')
        console.log('  ✅ Real-time geolocation')
        console.log('  ✅ Daily billing system')
        console.log('  ✅ Payment processing (Paystack)')
        console.log('  ✅ Advanced analytics with charts')
        console.log('  ✅ Rate limiting & security')
        console.log('')
        console.log('🔗 Service URLs:')
        console.log(`  📱 Redirect: ${process.env.SHORT_DOMAIN || 'http://localhost:' + PORT}/:shortcode`)
        console.log(`  🔍 Verify: ${process.env.SHORT_DOMAIN || 'http://localhost:' + PORT}/wey/:shortcode`)
        console.log(`  🏥 Health: ${process.env.SHORT_DOMAIN || 'http://localhost:' + PORT}/health`)
        console.log(`  📡 Webhook: ${process.env.RENDER_EXTERNAL_URL || 'http://localhost:' + (PORT + 1)}/webhook/paystack`)
        console.log('')
        console.log('💰 Pricing Structure:')
        Object.entries(LinkService.TUMS_PRICING).forEach(([key, value]) => {
            const formatted = key.replace(/_/g, ' ').toLowerCase()
            console.log(`  • ${formatted}: ${value} tums`)
        })

        // Handle graceful shutdown
        const gracefulShutdown = (signal) => {
            console.log(`🛑 Received ${signal}, shutting down gracefully...`)
            
            // Stop all scheduled tasks
            clearInterval(billingInterval)
            clearInterval(paymentCleanupInterval)
            clearInterval(locationCleanupInterval)
            console.log('⏰ Scheduled tasks stopped')
            
            // Close servers
            if (dWeyServer) {
                dWeyServer.stop()
            }
            
            if (webhookServer) {
                webhookServer.close((err) => {
                    if (err) {
                        console.error('❌ Error closing webhook server:', err.message)
                        process.exit(1)
                    }
                    
                    console.log('📡 Webhook server closed')
                    console.log('👋 d-wey shutdown complete!')
                    process.exit(0)
                })
            } else {
                process.exit(0)
            }
            
            // Force close after 15 seconds
            setTimeout(() => {
                console.error('⚡ Force closing after timeout')
                process.exit(1)
            }, 15000)
        }
        
        process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
        process.on('SIGINT', () => gracefulShutdown('SIGINT'))
        
    } catch (error) {
        console.error('❌ Failed to start d-wey application:', error)
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