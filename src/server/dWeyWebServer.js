const express = require('express')
const cors = require('cors')
const helmet = require('helmet')
const rateLimit = require('express-rate-limit')
const LinkService = require('../services/linkService')
const LocationService = require('../services/locationService')

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
        
        const limiter = rateLimit({
            windowMs: 15 * 60 * 1000,
            max: 1000,
            message: 'Too many requests, please try again later'
        })
        this.app.use(limiter)

        this.app.use(express.json())
        this.app.use(express.urlencoded({ extended: true }))

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

        // STEP 1: Intermediate redirect page - /:shortCode
        this.app.get('/:shortCode', async (req, res) => {
            const { shortCode } = req.params
            console.log(`🔗 Step 1 - Intermediate redirect: ${shortCode}`)
            
            try {
                const link = await LinkService.getLinkByShortCode(shortCode)
                
                if (!link) {
                    return this.sendNotFoundResponse(res, shortCode)
                }

                const clientIP = this.getRealIP(req)
                const userAgent = req.get('User-Agent') || 'unknown'
                
                // Get location data
                let location = null
                try {
                    const locationData = await LocationService.getCachedLocation(clientIP)
                    location = LocationService.formatLocation(locationData)
                } catch (error) {
                    console.log('⚠️ Location detection failed:', error.message)
                }

                // Parse device info with client hints if available
                const deviceInfo = this.parseDeviceInfo(req, userAgent)

                // Store device info for potential wey verification
                const verificationId = await LinkService.storeDeviceForWeyCheck(
                    shortCode, 
                    deviceInfo, 
                    clientIP
                )

                // Track the click BEFORE redirect
                await LinkService.trackClick(link.id, clientIP, userAgent, location)

                console.log(`🚀 Step 2 - Redirecting to: ${link.whatsapp_url}`)
                
                // Direct redirect to WhatsApp (no intermediate page needed)
                res.writeHead(302, {
                    'Location': link.whatsapp_url,
                    'Cache-Control': 'no-cache, no-store, must-revalidate',
                    'Set-Cookie': `dwey_verification=${verificationId}; Path=/; Max-Age=300; HttpOnly`
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
                const link = await LinkService.getLinkByShortCode(shortCode)
                
                if (!link) {
                    return this.sendWeyNotFound(res, shortCode)
                }

                const clientIP = this.getRealIP(req)
                const userAgent = req.get('User-Agent') || 'unknown'
                
                // Get verification ID from cookie
                const cookies = this.parseCookies(req.get('Cookie') || '')
                const verificationId = cookies.dwey_verification || null

                // Get location data
                let location = null
                try {
                    const locationData = await LocationService.getCachedLocation(clientIP)
                    location = LocationService.formatLocation(locationData)
                } catch (error) {
                    console.log('⚠️ Location detection failed for wey check')
                }

                // Track the wey check
                const trackingResult = await LinkService.trackWeyCheck(
                    link.id, 
                    verificationId,
                    clientIP, 
                    userAgent, 
                    location
                )
                
                if (trackingResult.success) {
                    // Generate wey verification report
                    const report = await LinkService.generateWeyReport(
                        shortCode,
                        trackingResult.deviceInfo,
                        location,
                        new Date().toISOString()
                    )
                    
                    // Send user to WhatsApp with pre-filled verification report
                    const botNumber = process.env.BOT_PHONE_NUMBER || '2348012345678'
                    const whatsappUrl = `https://wa.me/${botNumber}?text=${encodeURIComponent(report)}`
                    
                    console.log(`✅ Wey check processed, redirecting to WhatsApp`)
                    
                    res.writeHead(302, {
                        'Location': whatsappUrl,
                        'Cache-Control': 'no-cache, no-store, must-revalidate',
                        'Set-Cookie': 'dwey_verification=; Path=/; Max-Age=0; HttpOnly' // Clear cookie
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

        // API endpoint for basic link stats (for third-party access)
        this.app.get('/api/stats/:shortCode', async (req, res) => {
            try {
                const { shortCode } = req.params
                
                const link = await LinkService.getLinkByShortCode(shortCode)
                
                if (!link) {
                    return res.status(404).json({ error: 'Link not found' })
                }

                // Return basic public stats only
                const stats = {
                    shortCode: link.short_code,
                    isActive: link.is_active,
                    totalClicks: link.total_clicks,
                    uniqueClicks: link.unique_clicks,
                    weyChecks: link.wey_checks,
                    createdAt: link.created_at,
                    linkAge: Math.floor((new Date() - new Date(link.created_at)) / (1000 * 60 * 60 * 24))
                }

                res.json(stats)
            } catch (error) {
                console.error('❌ API stats error:', error)
                res.status(500).json({ error: 'Internal server error' })
            }
        })
    }

    // Parse device info with client hints support
    parseDeviceInfo(req, userAgent) {
        const deviceInfo = LinkService.parseUserAgent(userAgent)
        
        // Try to get additional info from client hints if available
        const headers = req.headers
        
        if (headers['sec-ch-ua-platform']) {
            const platform = headers['sec-ch-ua-platform'].replace(/"/g, '').toLowerCase()
            if (platform === 'android') deviceInfo.os = 'android'
            else if (platform === 'ios') deviceInfo.os = 'ios'
            else if (platform === 'windows') deviceInfo.os = 'windows'
            else if (platform === 'macos') deviceInfo.os = 'macos'
        }
        
        if (headers['sec-ch-ua-mobile'] === '?1') {
            deviceInfo.device = 'mobile'
        }

        // Try to get more specific device model from sec-ch-ua
        if (headers['sec-ch-ua']) {
            const ua = headers['sec-ch-ua'].toLowerCase()
            
            // Enhanced brand detection with client hints
            if (ua.includes('samsung')) deviceInfo.brand = 'Samsung'
            else if (ua.includes('google')) deviceInfo.brand = 'Google'
            else if (ua.includes('huawei')) deviceInfo.brand = 'Huawei'
            else if (ua.includes('xiaomi')) deviceInfo.brand = 'Xiaomi'
            else if (ua.includes('oppo')) deviceInfo.brand = 'Oppo'
            else if (ua.includes('vivo')) deviceInfo.brand = 'Vivo'
        }
        
        return deviceInfo
    }

    // Parse cookies helper
    parseCookies(cookieHeader) {
        const cookies = {}
        if (cookieHeader) {
            cookieHeader.split(';').forEach(cookie => {
                const [name, value] = cookie.trim().split('=')
                if (name && value) {
                    cookies[name] = decodeURIComponent(value)
                }
            })
        }
        return cookies
    }

    // Get real IP address from request
    getRealIP(req) {
        return req.ip || 
               req.connection.remoteAddress || 
               req.socket.remoteAddress ||
               (req.connection.socket ? req.connection.socket.remoteAddress : null) ||
               '127.0.0.1'
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
            console.log(`📊 Stats API: ${process.env.SHORT_DOMAIN || `http://${host}:${port}`}/api/stats/:shortcode`)
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