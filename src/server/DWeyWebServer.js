const express = require('express')
const cors = require('cors')
const helmet = require('helmet')
const rateLimit = require('express-rate-limit')
const cookieParser = require('cookie-parser')
const crypto = require('crypto')
const LinkService = require('../services/linkService')
const UserService = require('../services/userService')

class DWeyWebServer {
    constructor() {
        this.app = express()
        this.setupMiddleware()
        this.setupRoutes()
    }

    setupMiddleware() {
        this.app.set('trust proxy', true)
        
        this.app.use(helmet())
        this.app.use(cors())
        this.app.use(cookieParser())
        
        const limiter = rateLimit({
            windowMs: 15 * 60 * 1000,
            max: 1000,
            message: 'Too many requests, please try again later'
        })
        this.app.use(limiter)

        this.app.use(express.json())
        this.app.use(express.urlencoded({ extended: true }))

        this.app.use((req, res, next) => {
            console.log(`${req.method} ${req.url} - IP: ${req.ip}`)
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

        // Main redirect route
        this.app.get('/:shortCode', async (req, res) => {
            const { shortCode } = req.params
            console.log(`Redirect requested: ${shortCode}`)
            
            try {
                const link = await LinkService.getLinkByShortCode(shortCode)
                
                if (!link) {
                    console.log(`Link not found: ${shortCode}`)
                    return this.sendNotFoundResponse(res, shortCode)
                }

                // Get IP
                const clientIP = this.getRealIP(req)
                const hashedIP = LinkService.hashIP(clientIP)
                
                // Check if browser already has a d-wey cookie
                let browserCookie = req.cookies.d_wey_id
                
                // If no cookie exists, generate a new unique identifier
                if (!browserCookie) {
                    browserCookie = this.generateBrowserId()
                    console.log(`New browser detected, assigning cookie: ${browserCookie}`)
                } else {
                    console.log(`Existing browser detected: ${browserCookie}`)
                }

                // Hash the cookie for storage (privacy)
                const hashedCookie = LinkService.hashCookie(browserCookie)

                console.log(`Processing click from IP: ${clientIP}, Cookie: ${browserCookie.substring(0, 12)}...`)

                // Track the click with Nigeria timezone
                try {
                    await LinkService.trackClick(link.id, hashedIP, hashedCookie)
                    console.log('Click tracked successfully')
                } catch (trackError) {
                    console.error('Click tracking failed:', trackError.message)
                }

                // Determine target URL (temporal takes priority)
                const targetUrl = link.temporal_whatsapp_url || link.whatsapp_url
                
                console.log(`Redirecting to: ${targetUrl}`)
                
                // Set/update cookie for browser identification (1 year expiry)
                res.cookie('d_wey_id', browserCookie, {
                    maxAge: 365 * 24 * 60 * 60 * 1000, // 1 year
                    httpOnly: true,
                    secure: process.env.NODE_ENV === 'production',
                    sameSite: 'lax'
                })

                res.writeHead(302, {
                    'Location': targetUrl,
                    'Cache-Control': 'no-cache, no-store, must-revalidate',
                    'Pragma': 'no-cache',
                    'Expires': '0'
                })
                res.end()

            } catch (error) {
                console.error(`Redirect error for ${shortCode}:`, error)
                this.sendErrorResponse(res, error.message)
            }
        })

        // API endpoint for link info
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
                    createdAt: link.created_at,
                    expiresAt: link.expires_at
                }

                res.json(info)
            } catch (error) {
                console.error('API info error:', error)
                res.status(500).json({ error: 'Internal server error' })
            }
        })
    }

    // Generate unique browser ID
    generateBrowserId() {
        // Generate a random UUID-like identifier for the browser
        const timestamp = Date.now().toString(36)
        const randomStr = crypto.randomBytes(16).toString('hex')
        return `dwey_${timestamp}_${randomStr}`
    }

    getRealIP(req) {
        return req.ip || 
               req.connection.remoteAddress || 
               req.socket.remoteAddress ||
               (req.connection.socket ? req.connection.socket.remoteAddress : null) ||
               '127.0.0.1'
    }

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

    start(port = process.env.PORT || 3000) {
        const host = process.env.NODE_ENV === 'production' ? '0.0.0.0' : 'localhost'
        
        this.server = this.app.listen(port, host, () => {
            console.log(`d-wey server running on ${host}:${port}`)
            console.log(`Redirect: ${process.env.SHORT_DOMAIN || `http://${host}:${port}`}/:shortcode`)
            console.log(`Health: ${process.env.SHORT_DOMAIN || `http://${host}:${port}`}/health`)
        })
        
        return this.server
    }

    stop() {
        if (this.server) {
            this.server.close()
            console.log('d-wey server stopped')
        }
    }
}

module.exports = DWeyWebServer