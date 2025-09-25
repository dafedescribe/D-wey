const express = require('express')
const cors = require('cors')
const helmet = require('helmet')
const rateLimit = require('express-rate-limit')
const LinkService = require('../services/linkService')
const AnalyticsService = require('../services/analyticsService')
const LocationService = require('../services/locationService')
const UserService = require('../services/userService')

class DWeyWebServer {
    constructor() {
        this.app = express()
        this.setupMiddleware()
        this.setupRoutes()
    }

    setupMiddleware() {
        // Trust proxy for accurate IP detection
        this.app.set('trust proxy', true)
        
        // Security middleware
        this.app.use(helmet())
        this.app.use(cors())
        
        // Rate limiting
        const limiter = rateLimit({
            windowMs: 15 * 60 * 1000, // 15 minutes
            max: 1000, // Higher limit for redirect service
            message: 'Too many requests, please try again later'
        })
        this.app.use(limiter)

        // Body parsing
        this.app.use(express.json())
        this.app.use(express.urlencoded({ extended: true }))

        // Request logging
        this.app.use((req, res, next) => {
            console.log(`📥 ${req.method} ${req.url} - IP: ${req.ip}`)
            next()
        })
    }

    setupRoutes() {
        // Health check
        this.app.get('/health', (req, res) => {
            res.json({ 
                status: 'd-wey is running',
                timestamp: new Date().toISOString(),
                uptime: process.uptime()
            })
        })

        // Main redirect route - /:shortCode
        this.app.get('/:shortCode', async (req, res) => {
            const { shortCode } = req.params
            console.log(`🔗 Redirect requested: ${shortCode}`)
            
            try {
                // Get link from database
                const link = await LinkService.getLinkByShortCode(shortCode)
                
                if (!link) {
                    console.log(`❌ Link not found: ${shortCode}`)
                    return this.sendNotFoundResponse(res, shortCode)
                }

                // Get user's real IP
                const clientIP = this.getRealIP(req)
                const userAgent = req.get('User-Agent') || 'unknown'
                
                console.log(`📍 Processing click from IP: ${clientIP}`)
                
                // Get location data
                let location = null
                try {
                    const locationData = await LocationService.getCachedLocation(clientIP)
                    location = LocationService.formatLocation(locationData)
                    console.log(`📍 Location: ${location}`)
                } catch (error) {
                    console.log('⚠️ Location detection failed:', error.message)
                }

                // Track the click BEFORE redirect
                try {
                    await LinkService.trackClick(link.id, clientIP, userAgent, location)
                    console.log('✅ Click tracked successfully')
                } catch (trackError) {
                    console.error('❌ Click tracking failed:', trackError.message)
                    // Continue with redirect even if tracking fails
                }

                // Perform redirect to WhatsApp
                console.log(`🚀 Redirecting to: ${link.whatsapp_url}`)
                
                // Send redirect with proper headers
                res.writeHead(302, {
                    'Location': link.whatsapp_url,
                    'Cache-Control': 'no-cache, no-store, must-revalidate',
                    'Pragma': 'no-cache',
                    'Expires': '0'
                })
                res.end()

            } catch (error) {
                console.error(`❌ Redirect error for ${shortCode}:`, error)
                this.sendErrorResponse(res, error.message)
            }
        })

        // Wey verification route - /wey/:shortCode
        this.app.get('/wey/:shortCode', async (req, res) => {
            const { shortCode } = req.params
            console.log(`🔍 Wey verification requested: ${shortCode}`)
            
            try {
                // Get link from database (no ownership check needed for verification)
                const link = await LinkService.getLinkByShortCode(shortCode)
                
                if (!link) {
                    console.log(`❌ Link not found for wey check: ${shortCode}`)
                    return this.sendWeyNotFound(res, shortCode)
                }

                // Get user's real IP and device info
                const clientIP = this.getRealIP(req)
                const userAgent = req.get('User-Agent') || 'unknown'
                
                // Get location data
                let location = null
                try {
                    const locationData = await LocationService.getCachedLocation(clientIP)
                    location = LocationService.formatLocation(locationData)
                } catch (error) {
                    console.log('⚠️ Location detection failed for wey check')
                }

                // Track the wey check
                const trackingResult = await LinkService.trackWeyCheck(link.id, clientIP, userAgent, location)
                
                if (trackingResult.success) {
                    // Generate third-party verification report
                    const report = await AnalyticsService.generateThirdPartyReport(
                        shortCode, 
                        trackingResult.deviceInfo, 
                        trackingResult.hashedIp,
                        location
                    )
                    
                    // Send user directly to WhatsApp with pre-filled verification message
                    const verificationMessage = this.createVerificationMessage(report)
                    const botNumber = process.env.BOT_PHONE_NUMBER || '2348012345678'
                    const whatsappUrl = `https://wa.me/${botNumber}?text=${encodeURIComponent(verificationMessage)}`
                    
                    console.log(`✅ Wey check processed, redirecting to WhatsApp`)
                    
                    res.writeHead(302, {
                        'Location': whatsappUrl,
                        'Cache-Control': 'no-cache, no-store, must-revalidate',
                        'Pragma': 'no-cache',
                        'Expires': '0'
                    })
                    res.end()
                } else {
                    throw new Error('Failed to process verification')
                }

            } catch (error) {
                console.error(`❌ Wey verification error for ${shortCode}:`, error)
                this.sendWeyError(res, error.message)
            }
        })

        // API endpoint for quick link info (optional)
        this.app.get('/api/info/:shortCode', async (req, res) => {
            try {
                const { shortCode } = req.params
                
                const link = await LinkService.getLinkByShortCode(shortCode)
                
                if (!link) {
                    return res.status(404).json({ error: 'Link not found' })
                }

                // Return basic public info only
                const info = {
                    shortCode: link.short_code,
                    isActive: link.is_active,
                    totalClicks: link.total_clicks,
                    uniqueClicks: link.unique_clicks,
                    weyChecks: link.wey_checks,
                    createdAt: link.created_at,
                    expiresAt: link.expires_at
                }

                res.json(info)
            } catch (error) {
                console.error('❌ API info error:', error)
                res.status(500).json({ error: 'Internal server error' })
            }
        })
    }

    // Get real IP address from request
    getRealIP(req) {
        return req.ip || 
               req.connection.remoteAddress || 
               req.socket.remoteAddress ||
               (req.connection.socket ? req.connection.socket.remoteAddress : null) ||
               '127.0.0.1'
    }

    // Create verification message for WhatsApp
    createVerificationMessage(report) {
        const { verification, linkStats, authenticity } = report
        
        let message = `🔍 LINK VERIFICATION REQUEST\n\n`
        message += `Code: ${verification.shortCode}\n`
        message += `Verified: ${new Date(verification.verifiedAt).toLocaleString()}\n`
        message += `Trust Score: ${authenticity.trustScore}/100\n\n`
        message += `My Device: ${verification.verifierInfo.device} | ${verification.verifierInfo.browser}\n`
        message += `Location: ${verification.verifierInfo.location}\n`
        message += `ID: ${verification.verifierInfo.hashedId}\n\n`
        message += `Link Stats: ${linkStats.totalClicks} clicks | ${linkStats.uniqueVisitors} unique\n\n`
        message += `Please send me the verification report for this link.`
        
        return message
    }

    // Send 404 response for missing redirect links
    sendNotFoundResponse(res, shortCode) {
        const botNumber = process.env.BOT_PHONE_NUMBER || '2348012345678'
        const message = `Hi! The link "${shortCode}" was not found. Can you help me create a WhatsApp link?`
        const whatsappUrl = `https://wa.me/${botNumber}?text=${encodeURIComponent(message)}`
        
        res.writeHead(302, {
            'Location': whatsappUrl,
            'Cache-Control': 'no-cache'
        })
        res.end()
    }

    // Send 404 response for missing wey links
    sendWeyNotFound(res, shortCode) {
        const botNumber = process.env.BOT_PHONE_NUMBER || '2348012345678'
        const message = `Hi! I tried to verify link "${shortCode}" but it wasn't found. Can you help?`
        const whatsappUrl = `https://wa.me/${botNumber}?text=${encodeURIComponent(message)}`
        
        res.writeHead(302, {
            'Location': whatsappUrl,
            'Cache-Control': 'no-cache'
        })
        res.end()
    }

    // Send error response
    sendErrorResponse(res, errorMessage) {
        const botNumber = process.env.BOT_PHONE_NUMBER || '2348012345678'
        const message = `Hi! I encountered an error: ${errorMessage}. Can you help me?`
        const whatsappUrl = `https://wa.me/${botNumber}?text=${encodeURIComponent(message)}`
        
        res.writeHead(302, {
            'Location': whatsappUrl,
            'Cache-Control': 'no-cache'
        })
        res.end()
    }

    // Send wey error response
    sendWeyError(res, errorMessage) {
        const botNumber = process.env.BOT_PHONE_NUMBER || '2348012345678'
        const message = `Hi! I had trouble verifying this link: ${errorMessage}. Can you assist?`
        const whatsappUrl = `https://wa.me/${botNumber}?text=${encodeURIComponent(message)}`
        
        res.writeHead(302, {
            'Location': whatsappUrl,
            'Cache-Control': 'no-cache'
        })
        res.end()
    }

    start(port = process.env.PORT || 3000) {
        const host = process.env.NODE_ENV === 'production' ? '0.0.0.0' : 'localhost'
        
        this.server = this.app.listen(port, host, () => {
            console.log(`🌐 d-wey server running on ${host}:${port}`)
            console.log(`🔗 Redirect: ${process.env.SHORT_DOMAIN || `http://${host}:${port}`}/:shortcode`)
            console.log(`🔍 Verify: ${process.env.SHORT_DOMAIN || `http://${host}:${port}`}/wey/:shortcode`)
            console.log(`🏥 Health: ${process.env.SHORT_DOMAIN || `http://${host}:${port}`}/health`)
        })
        
        return this.server
    }

    stop() {
        if (this.server) {
            this.server.close()
            console.log('🛑 d-wey server stopped')
        }
    }
}

module.exports = DWeyWebServer