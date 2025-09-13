require('dotenv').config()
const express = require('express')
const { connectToWhatsApp } = require('./bot/connection')
const { handlePaystackWebhook, cleanupAbandonedPayments } = require('./webhook/paymentWebhook')
const PaymentService = require('./services/paymentService')

const app = express()
const PORT = process.env.PORT || 3000

// Middleware
app.use(express.json())
app.use(express.raw({ type: 'application/json' }))

// Health check endpoint
app.get('/', (req, res) => {
    res.json({ 
        status: 'WhatsApp Email Collector Bot is running!',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        version: '2.0.0'
    })
})

// Health check endpoint with detailed status
app.get('/health', async (req, res) => {
    try {
        const stats = await PaymentService.getTransactionStats()
        res.json({
            status: 'healthy',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            services: {
                whatsapp: 'connected',
                database: 'connected',
                webhook: 'active'
            },
            stats: stats || {
                message: 'No transactions yet'
            }
        })
    } catch (error) {
        res.status(503).json({
            status: 'unhealthy',
            timestamp: new Date().toISOString(),
            error: error.message
        })
    }
})

// Paystack webhook endpoint
app.post('/webhook/paystack', handlePaystackWebhook)

// Admin endpoint to manually trigger cleanup (for testing)
app.post('/admin/cleanup', async (req, res) => {
    try {
        const count = await PaymentService.cleanupExpiredTransactions()
        res.json({
            message: `Cleaned up ${count} expired transactions`,
            timestamp: new Date().toISOString()
        })
    } catch (error) {
        res.status(500).json({
            error: 'Cleanup failed',
            message: error.message
        })
    }
})

// Admin endpoint to get transaction statistics
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

// Admin endpoint to verify a specific payment
app.post('/admin/verify/:reference', async (req, res) => {
    try {
        const { reference } = req.params
        
        if (!PaymentService.isValidReference(reference)) {
            return res.status(400).json({
                error: 'Invalid reference format'
            })
        }

        const verification = await PaymentService.verifyPayment(reference)
        res.json({
            reference,
            verification,
            timestamp: new Date().toISOString()
        })
    } catch (error) {
        res.status(500).json({
            error: 'Verification failed',
            message: error.message
        })
    }
})

async function startApplication() {
    console.log('🚀 Starting Enhanced Email Collector Bot v2.0...')
    
    try {
        // Start WhatsApp bot
        await connectToWhatsApp()
        console.log('✅ WhatsApp Bot connected!')
        
        // Start webhook server
        const server = app.listen(PORT, () => {
            console.log(`🌐 Webhook server running on port ${PORT}`)
            console.log(`📡 Webhook URL: ${process.env.RENDER_EXTERNAL_URL || 'http://localhost:' + PORT}/webhook/paystack`)
            console.log(`🏥 Health check: ${process.env.RENDER_EXTERNAL_URL || 'http://localhost:' + PORT}/health`)
        })
        
        // Start cleanup scheduler (runs every 30 minutes)
        console.log('🧹 Starting transaction cleanup scheduler...')
        const cleanupInterval = setInterval(async () => {
            try {
                console.log('🧹 Running scheduled cleanup...')
                const expiredCount = await PaymentService.cleanupExpiredTransactions()
                const abandonedCount = await cleanupAbandonedPayments()
                
                if (expiredCount > 0 || abandonedCount > 0) {
                    console.log(`✅ Cleanup completed: ${expiredCount} expired, ${abandonedCount} abandoned`)
                } else {
                    console.log('✅ Cleanup completed: No transactions to clean')
                }
            } catch (error) {
                console.error('❌ Scheduled cleanup error:', error.message)
            }
        }, 30 * 60 * 1000) // 30 minutes

        // Run initial cleanup after 1 minute
        setTimeout(async () => {
            console.log('🧹 Running initial cleanup...')
            try {
                const expiredCount = await PaymentService.cleanupExpiredTransactions()
                console.log(`✅ Initial cleanup: ${expiredCount} expired transactions handled`)
            } catch (error) {
                console.error('❌ Initial cleanup error:', error.message)
            }
        }, 60000) // 1 minute

        // Log startup completion
        console.log('🎉 Application started successfully!')
        console.log('📊 Features enabled:')
        console.log('  ✅ Card payments (Visa, Mastercard, Verve)')
        console.log('  ✅ Payment failure notifications')
        console.log('  ✅ Payment cancellation notifications')
        console.log('  ✅ Automatic transaction cleanup')
        console.log('  ✅ Payment dispute handling')
        console.log('  ✅ Payment reversal support')
        console.log('  ✅ Enhanced error messages')
        console.log('  ✅ Admin endpoints for monitoring')

        // Handle graceful shutdown
        const gracefulShutdown = (signal) => {
            console.log(`🛑 Received ${signal}, shutting down gracefully...`)
            
            // Stop the cleanup scheduler
            clearInterval(cleanupInterval)
            console.log('🧹 Cleanup scheduler stopped')
            
            // Close the server
            server.close((err) => {
                if (err) {
                    console.error('❌ Error closing server:', err.message)
                    process.exit(1)
                }
                
                console.log('🌐 Server closed')
                console.log('👋 Goodbye!')
                process.exit(0)
            })
            
            // Force close after 10 seconds
            setTimeout(() => {
                console.error('⚡ Force closing after timeout')
                process.exit(1)
            }, 10000)
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