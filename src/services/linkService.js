const { supabase } = require('../config/database')
const crypto = require('crypto')
const UserService = require('./userService')

class LinkService {
    static PRICING = {
        CREATE_LINK: 250,
        DAILY_MAINTENANCE: 20,
        REACTIVATE_LINK: 100,
        LINK_INFO_CHECK: 10,
        SET_TEMPORAL_TARGET: 10,
        KILL_TEMPORAL_TARGET: 10
    }

    // WhatsApp socket for notifications
    static whatsappSocket = null

    // FIXED: Store timestamps in UTC (standard practice)
    static getCurrentTimestamp() {
        return new Date().toISOString()
    }

    // Format date for Nigeria timezone display
    static formatNigeriaTime(dateString) {
        return new Date(dateString).toLocaleString('en-GB', {
            timeZone: 'Africa/Lagos',
            year: 'numeric',
            month: 'short',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        })
    }

    // Get Nigeria hour (0-23) from a UTC timestamp
    static getNigeriaHour(dateString) {
        const date = new Date(dateString)
        return parseInt(date.toLocaleString('en-US', { 
            timeZone: 'Africa/Lagos', 
            hour: '2-digit', 
            hour12: false 
        }))
    }

    // Get Nigeria day of week from a UTC timestamp
    static getNigeriaDayOfWeek(dateString) {
        const date = new Date(dateString)
        return date.toLocaleDateString('en-US', { 
            timeZone: 'Africa/Lagos', 
            weekday: 'long' 
        })
    }

    // Get Nigeria date string (YYYY-MM-DD) from a UTC timestamp
    static getNigeriaDateString(dateString) {
        const date = new Date(dateString)
        return date.toLocaleDateString('en-CA', { 
            timeZone: 'Africa/Lagos' 
        })
    }

    // Generate random short code
    static generateShortCode(length = 6) {
        const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
        let result = ''
        for (let i = 0; i < length; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length))
        }
        return result
    }

    // Hash IP address for privacy
    static hashIP(ipAddress) {
        return crypto.createHash('sha256').update(ipAddress).digest('hex')
    }

    // Hash cookie/browser identifier
    static hashCookie(cookieId) {
        return crypto.createHash('sha256').update(cookieId).digest('hex')
    }

    // Validate phone number format
    static validatePhoneNumber(phoneNumber) {
        const cleanNumber = phoneNumber.replace(/\D/g, '')
        
        if (cleanNumber.length < 10 || cleanNumber.length > 15) {
            throw new Error('Phone number must be between 10-15 digits')
        }
        
        if (cleanNumber.startsWith('0')) {
            return '234' + cleanNumber.substring(1)
        } else if (cleanNumber.startsWith('234')) {
            return cleanNumber
        } else if (cleanNumber.length === 10) {
            return '234' + cleanNumber
        }
        
        return cleanNumber
    }

    // Set WhatsApp socket for notifications
    static setWhatsAppSocket(sock) {
        this.whatsappSocket = sock
        console.log('📱 WhatsApp socket set for link notifications')
    }

    // Send notification to user via WhatsApp
    static async notifyUser(phoneNumber, message) {
        try {
            if (!this.whatsappSocket) {
                console.log('⚠️ WhatsApp socket not available for notifications')
                return false
            }

            const jid = `${phoneNumber}@s.whatsapp.net`
            await this.whatsappSocket.sendMessage(jid, { text: message })
            console.log(`📤 Notification sent to ${phoneNumber}`)
            return true
        } catch (error) {
            console.error(`❌ Failed to send notification to ${phoneNumber}:`, error.message)
            return false
        }
    }

    // Create WhatsApp redirect link
    static async createWhatsAppLink(creatorPhone, targetPhone, customShortCode = null, customMessage = null) {
        try {
            console.log(`Creating link: ${creatorPhone} -> ${targetPhone}`)
            
            // Soft register both creator and target
            await UserService.softRegisterUser(creatorPhone)
            await UserService.softRegisterUser(targetPhone)

            // Validate creator has sufficient balance
            const creator = await UserService.getUserByPhone(creatorPhone)
            if (!creator) {
                throw new Error('User not found')
            }

            const totalCost = this.PRICING.CREATE_LINK

            if (creator.wallet_balance < totalCost) {
                throw new Error(`Insufficient balance. Need ${totalCost} tums, you have ${creator.wallet_balance}`)
            }

            // Validate and format target phone number
            const formattedTargetPhone = this.validatePhoneNumber(targetPhone)

            // Handle short code generation/validation
            let shortCode
            if (customShortCode && customShortCode.trim()) {
                shortCode = await this.generateCustomShortCode(customShortCode.trim())
            } else {
                shortCode = await this.generateUniqueShortCode()
            }

            // Create default message if none provided
            const defaultMessage = customMessage || `Hello! I'd like to chat with you.`
            
            // Generate WhatsApp URL - preserve line breaks in the message
            const whatsappUrl = `https://wa.me/${formattedTargetPhone}?text=${encodeURIComponent(defaultMessage)}`
            
            // Create redirect link
            const redirectUrl = `${process.env.SHORT_DOMAIN || 'https://d-wey.com'}/${shortCode}`

            // Calculate expiration (24 hours from now)
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)

            // Create link record with UTC timestamps
            const now = this.getCurrentTimestamp()
            const linkData = {
                creator_phone: creatorPhone,
                target_phone: formattedTargetPhone,
                temporal_target_phone: null,
                whatsapp_url: whatsappUrl,
                short_code: shortCode,
                redirect_url: redirectUrl,
                custom_message: customMessage,
                total_clicks: 0,
                unique_clicks: 0,
                is_active: true,
                expires_at: expiresAt.toISOString(),
                next_billing_at: expiresAt.toISOString(),
                created_at: now,
                updated_at: now
            }

            const { data: newLink, error } = await supabase
                .from('whatsapp_links')
                .insert([linkData])
                .select()
                .single()

            if (error) {
                console.error('Database insert error:', error)
                throw new Error(`Database error: ${error.message}`)
            }

            // Deduct tums from creator's balance
            await UserService.deductFromWallet(
                creatorPhone, 
                totalCost, 
                `Link created (${shortCode})`
            )

            console.log(`Link created: ${shortCode} -> ${formattedTargetPhone}, cost: ${totalCost}`)
            
            return {
                link: newLink,
                redirectUrl,
                shortCode,
                cost: totalCost,
                expiresAt
            }

        } catch (error) {
            console.error('Error creating link:', error.message)
            throw error
        }
    }

    // Generate unique short code
    static async generateUniqueShortCode() {
        let attempts = 0
        const maxAttempts = 10

        while (attempts < maxAttempts) {
            const shortCode = this.generateShortCode().toLowerCase()
            
            const { data: existing, error } = await supabase
                .from('whatsapp_links')
                .select('id')
                .eq('short_code', shortCode)
                .maybeSingle()

            if (error) {
                console.error('Error checking shortcode uniqueness:', error)
                attempts++
                continue
            }

            if (!existing) {
                return shortCode
            }
            attempts++
        }

        throw new Error('Failed to generate unique short code')
    }

    // Handle custom short code with variations
    static async generateCustomShortCode(requested) {
        const cleanCode = requested.replace(/[^a-zA-Z0-9]/g, '')
        
        if (cleanCode.length < 3) {
            throw new Error('Custom short code must be at least 3 characters')
        }

        if (cleanCode.length > 20) {
            throw new Error('Custom short code must be less than 20 characters')
        }

        // Convert to lowercase for storage and checking
        const baseCode = cleanCode.toLowerCase()

        // Try original first
        const { data: existing, error } = await supabase
            .from('whatsapp_links')
            .select('id')
            .eq('short_code', baseCode)
            .maybeSingle()

        if (error) {
            throw new Error('Database error checking shortcode availability')
        }

        if (!existing) {
            return baseCode
        }

        // Try variations: baseCode1, baseCode2, etc.
        for (let i = 1; i <= 99; i++) {
            const variation = `${baseCode}${i}`
            
            const { data: existingVar, error: varError } = await supabase
                .from('whatsapp_links')
                .select('id')
                .eq('short_code', variation)
                .maybeSingle()

            if (varError) {
                continue
            }

            if (!existingVar) {
                return variation
            }
        }

        throw new Error(`Custom short code '${requested}' and variations are taken`)
    }

    // Get link by short code
    static async getLinkByShortCode(shortCode) {
        try {
            const normalizedCode = shortCode.toLowerCase()
            
            const { data, error } = await supabase
                .from('whatsapp_links')
                .select('*')
                .eq('short_code', normalizedCode)
                .eq('is_active', true)
                .maybeSingle()

            if (error) {
                console.error('Error getting link:', error)
                return null
            }
            
            if (!data) {
                return null
            }

            // Check if link is expired
            if (new Date(data.expires_at) < new Date()) {
                await this.deactivateLink(normalizedCode, 'expired')
                return null
            }

            return data
            
        } catch (error) {
            console.error('Error getting link:', error.message)
            return null
        }
    }

    // FIXED: Track click with UTC timestamp
    static async trackClick(linkId, hashedIP, hashedCookie) {
        try {
            console.log(`Tracking click for link: ${linkId}`)
            
            // Check if this IP or cookie has clicked before
            const { data: existingClicks, error: checkError } = await supabase
                .from('link_clicks')
                .select('id')
                .eq('link_id', linkId)
                .or(`hashed_ip.eq.${hashedIP},hashed_cookie.eq.${hashedCookie}`)

            if (checkError) {
                console.error('Error checking existing click:', checkError)
            }

            const isUnique = !existingClicks || existingClicks.length === 0

            // Store in UTC
            const clickData = {
                link_id: linkId,
                hashed_ip: hashedIP,
                hashed_cookie: hashedCookie,
                is_unique: isUnique,
                clicked_at: this.getCurrentTimestamp()
            }

            const { error: clickError } = await supabase
                .from('link_clicks')
                .insert([clickData])

            if (clickError) {
                console.error('Error inserting click:', clickError)
                throw clickError
            }

            // Get current link stats
            const { data: currentLink, error: getCurrentError } = await supabase
                .from('whatsapp_links')
                .select('total_clicks, unique_clicks')
                .eq('id', linkId)
                .single()

            if (getCurrentError) {
                throw getCurrentError
            }

            // Update link statistics
            const newTotalClicks = (currentLink.total_clicks || 0) + 1
            const newUniqueClicks = (currentLink.unique_clicks || 0) + (isUnique ? 1 : 0)

            const { error: updateError } = await supabase
                .from('whatsapp_links')
                .update({ 
                    total_clicks: newTotalClicks,
                    unique_clicks: newUniqueClicks,
                    last_clicked_at: this.getCurrentTimestamp(),
                    updated_at: this.getCurrentTimestamp()
                })
                .eq('id', linkId)

            if (updateError) {
                throw updateError
            }

            console.log(`Click tracked: ${linkId} (unique: ${isUnique})`)
            return { success: true, isUnique }

        } catch (error) {
            console.error('Error tracking click:', error.message)
            return { success: false, isUnique: false }
        }
    }

    // Reactivate a link
    static async reactivateLink(phoneNumber, shortCode) {
        try {
            const normalizedCode = shortCode.toLowerCase()
            
            // Verify ownership
            const link = await this.verifyLinkOwnership(phoneNumber, normalizedCode)
            
            // Check if already active
            if (link.is_active) {
                throw new Error('Link is already active')
            }

            // Check balance
            const user = await UserService.getUserByPhone(phoneNumber)
            if (user.wallet_balance < this.PRICING.REACTIVATE_LINK) {
                throw new Error(`Insufficient balance. Need ${this.PRICING.REACTIVATE_LINK} tums`)
            }

            // Calculate new expiration (24 hours from now)
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)

            // Reactivate the link
            const { error } = await supabase
                .from('whatsapp_links')
                .update({
                    is_active: true,
                    expires_at: expiresAt.toISOString(),
                    next_billing_at: expiresAt.toISOString(),
                    deactivated_at: null,
                    deactivation_reason: null,
                    deletion_warning_sent: null,
                    updated_at: this.getCurrentTimestamp()
                })
                .eq('short_code', normalizedCode)
                .eq('creator_phone', phoneNumber)

            if (error) throw error

            // Deduct tums
            await UserService.deductFromWallet(
                phoneNumber,
                this.PRICING.REACTIVATE_LINK,
                `Link reactivated (${normalizedCode})`
            )

            console.log(`Link reactivated: ${normalizedCode}`)
            return { 
                success: true, 
                shortCode: normalizedCode,
                targetPhone: link.target_phone,
                redirectUrl: link.redirect_url,
                expiresAt
            }

        } catch (error) {
            console.error('Error reactivating link:', error.message)
            throw error
        }
    }

    // Set temporal target number
    static async setTemporalTarget(phoneNumber, shortCode, temporalTargetPhone) {
        try {
            const normalizedCode = shortCode.toLowerCase()
            
            // Verify ownership
            const link = await this.verifyLinkOwnership(phoneNumber, normalizedCode)
            
            // Check if temporal target already exists
            if (link.temporal_target_phone) {
                throw new Error('Temporal target already set. Kill it first to set a new one.')
            }

            // Validate user balance
            const user = await UserService.getUserByPhone(phoneNumber)
            if (user.wallet_balance < this.PRICING.SET_TEMPORAL_TARGET) {
                throw new Error(`Insufficient balance. Need ${this.PRICING.SET_TEMPORAL_TARGET} tums`)
            }

            // Format temporal target phone
            const formattedTemporalPhone = this.validatePhoneNumber(temporalTargetPhone)
            
            // Soft register temporal target
            await UserService.softRegisterUser(formattedTemporalPhone)

            // Update temporal target URL - preserve line breaks
            const temporalMessage = link.custom_message || `Hello! I'd like to chat with you.`
            const temporalWhatsappUrl = `https://wa.me/${formattedTemporalPhone}?text=${encodeURIComponent(temporalMessage)}`

            // Update link with temporal target
            const { error } = await supabase
                .from('whatsapp_links')
                .update({
                    temporal_target_phone: formattedTemporalPhone,
                    temporal_whatsapp_url: temporalWhatsappUrl,
                    temporal_set_at: this.getCurrentTimestamp(),
                    updated_at: this.getCurrentTimestamp()
                })
                .eq('short_code', normalizedCode)
                .eq('creator_phone', phoneNumber)

            if (error) throw error

            // Deduct tums
            await UserService.deductFromWallet(
                phoneNumber,
                this.PRICING.SET_TEMPORAL_TARGET,
                `Temporal target set for ${normalizedCode}`
            )

            console.log(`Temporal target set: ${normalizedCode} -> ${formattedTemporalPhone}`)
            return { success: true, temporalTarget: formattedTemporalPhone }

        } catch (error) {
            console.error('Error setting temporal target:', error.message)
            throw error
        }
    }

    // Kill temporal target number
    static async killTemporalTarget(phoneNumber, shortCode) {
        try {
            const normalizedCode = shortCode.toLowerCase()
            
            // Verify ownership
            const link = await this.verifyLinkOwnership(phoneNumber, normalizedCode)
            
            if (!link.temporal_target_phone) {
                throw new Error('No temporal target set for this link')
            }

            // Validate user balance
            const user = await UserService.getUserByPhone(phoneNumber)
            if (user.wallet_balance < this.PRICING.KILL_TEMPORAL_TARGET) {
                throw new Error(`Insufficient balance. Need ${this.PRICING.KILL_TEMPORAL_TARGET} tums`)
            }

            // Remove temporal target
            const { error } = await supabase
                .from('whatsapp_links')
                .update({
                    temporal_target_phone: null,
                    temporal_whatsapp_url: null,
                    temporal_set_at: null,
                    updated_at: this.getCurrentTimestamp()
                })
                .eq('short_code', normalizedCode)
                .eq('creator_phone', phoneNumber)

            if (error) throw error

            // Deduct tums
            await UserService.deductFromWallet(
                phoneNumber,
                this.PRICING.KILL_TEMPORAL_TARGET,
                `Temporal target killed for ${normalizedCode}`
            )

            console.log(`Temporal target killed: ${normalizedCode}`)
            return { success: true }

        } catch (error) {
            console.error('Error killing temporal target:', error.message)
            throw error
        }
    }

    // Get link info with analytics (costs 10 tums)
    static async getLinkInfo(phoneNumber, shortCode) {
        try {
            const normalizedCode = shortCode.toLowerCase()
            
            // Get link
            const { data: link, error: linkError } = await supabase
                .from('whatsapp_links')
                .select('*')
                .eq('short_code', normalizedCode)
                .single()

            if (linkError || !link) {
                throw new Error('Link not found')
            }

            // Check if user has access (creator or target)
            const hasAccess = link.creator_phone === phoneNumber || 
                             link.target_phone === phoneNumber ||
                             link.temporal_target_phone === phoneNumber

            if (!hasAccess) {
                throw new Error('You do not have access to this link')
            }

            // Charge for link info check
            const user = await UserService.getUserByPhone(phoneNumber)
            if (user.wallet_balance < this.PRICING.LINK_INFO_CHECK) {
                throw new Error(`Insufficient balance. Need ${this.PRICING.LINK_INFO_CHECK} tums`)
            }

            await UserService.deductFromWallet(
                phoneNumber,
                this.PRICING.LINK_INFO_CHECK,
                `Link info check - ${normalizedCode}`
            )

            // Get enhanced click analytics
            const analytics = await this.getLinkAnalytics(link.id)

            return {
                link: {
                    shortCode: link.short_code,
                    redirectUrl: link.redirect_url,
                    targetPhone: link.target_phone,
                    temporalTarget: link.temporal_target_phone,
                    totalClicks: link.total_clicks,
                    uniqueClicks: link.unique_clicks,
                    isActive: link.is_active,
                    createdAt: link.created_at,
                    expiresAt: link.expires_at
                },
                analytics
            }

        } catch (error) {
            console.error('Error getting link info:', error.message)
            throw error
        }
    }

    // FIXED: Get comprehensive link analytics (convert UTC to Nigeria time for display)
    static async getLinkAnalytics(linkId) {
        try {
            const { data: clicks, error } = await supabase
                .from('link_clicks')
                .select('clicked_at, is_unique')
                .eq('link_id', linkId)
                .order('clicked_at', { ascending: true })

            if (error) throw error

            if (!clicks || clicks.length === 0) {
                return {
                    peakTime: 'No data yet',
                    peakDay: 'No data yet',
                    peakDayOfWeek: 'No data yet',
                    clicksByHour: {},
                    clicksByDay: {},
                    clicksByDayOfWeek: {},
                    uniqueClickRate: 0,
                    totalClicks: 0,
                    uniqueClicks: 0,
                    firstClick: null,
                    lastClick: null,
                    averageClicksPerDay: 0
                }
            }

            // Initialize counters
            const clicksByHour = {}
            const clicksByDay = {}
            const clicksByDayOfWeek = {
                'Sunday': 0,
                'Monday': 0,
                'Tuesday': 0,
                'Wednesday': 0,
                'Thursday': 0,
                'Friday': 0,
                'Saturday': 0
            }
            
            let uniqueClicks = 0

            // Process all clicks (convert UTC to Nigeria time)
            clicks.forEach(click => {
                // Get hour in Nigeria timezone
                const hour = this.getNigeriaHour(click.clicked_at)
                clicksByHour[hour] = (clicksByHour[hour] || 0) + 1
                
                // Get day in Nigeria timezone
                const dayKey = this.getNigeriaDateString(click.clicked_at)
                clicksByDay[dayKey] = (clicksByDay[dayKey] || 0) + 1
                
                // Get day of week in Nigeria timezone
                const dayOfWeek = this.getNigeriaDayOfWeek(click.clicked_at)
                clicksByDayOfWeek[dayOfWeek]++
                
                // Count unique clicks
                if (click.is_unique) {
                    uniqueClicks++
                }
            })

            // Find peak hour
            let peakHour = 0
            let maxHourClicks = 0
            Object.entries(clicksByHour).forEach(([hour, count]) => {
                if (count > maxHourClicks) {
                    maxHourClicks = count
                    peakHour = parseInt(hour)
                }
            })

            // Find peak day (specific date)
            let peakDay = null
            let maxDayClicks = 0
            Object.entries(clicksByDay).forEach(([day, count]) => {
                if (count > maxDayClicks) {
                    maxDayClicks = count
                    peakDay = day
                }
            })

            // Find peak day of week
            let peakDayOfWeek = null
            let maxDayOfWeekClicks = 0
            Object.entries(clicksByDayOfWeek).forEach(([day, count]) => {
                if (count > maxDayOfWeekClicks) {
                    maxDayOfWeekClicks = count
                    peakDayOfWeek = day
                }
            })

            // Calculate average clicks per day
            const dayCount = Object.keys(clicksByDay).length
            const averageClicksPerDay = dayCount > 0 ? (clicks.length / dayCount).toFixed(1) : 0

            // Calculate unique click rate
            const uniqueClickRate = clicks.length > 0 ? ((uniqueClicks / clicks.length) * 100).toFixed(1) : 0

            // Format peak day nicely
            const formattedPeakDay = peakDay ? new Date(peakDay + 'T00:00:00Z').toLocaleDateString('en-GB', {
                timeZone: 'Africa/Lagos',
                day: '2-digit',
                month: 'short',
                year: 'numeric'
            }) : 'No data yet'

            return {
                // Time of day analytics
                peakTime: `${peakHour}:00 - ${peakHour + 1}:00`,
                peakHour: peakHour,
                clicksByHour: clicksByHour,
                
                // Day analytics
                peakDay: formattedPeakDay,
                peakDayRaw: peakDay,
                peakDayClicks: maxDayClicks,
                clicksByDay: clicksByDay,
                
                // Day of week analytics
                peakDayOfWeek: peakDayOfWeek,
                peakDayOfWeekClicks: maxDayOfWeekClicks,
                clicksByDayOfWeek: clicksByDayOfWeek,
                
                // General stats
                totalClicks: clicks.length,
                uniqueClicks: uniqueClicks,
                uniqueClickRate: `${uniqueClickRate}%`,
                averageClicksPerDay: parseFloat(averageClicksPerDay),
                
                // Timeline
                firstClick: clicks[0].clicked_at,
                lastClick: clicks[clicks.length - 1].clicked_at,
                
                // Activity summary
                totalDays: dayCount,
                activeHours: Object.keys(clicksByHour).length,
                activeDaysOfWeek: Object.values(clicksByDayOfWeek).filter(count => count > 0).length
            }

        } catch (error) {
            console.error('Error getting analytics:', error.message)
            return null
        }
    }

    // Verify link ownership
    static async verifyLinkOwnership(phoneNumber, shortCode) {
        const normalizedCode = shortCode.toLowerCase()
        
        const { data: link, error } = await supabase
            .from('whatsapp_links')
            .select('*')
            .eq('short_code', normalizedCode)
            .eq('creator_phone', phoneNumber)
            .maybeSingle()

        if (error || !link) {
            throw new Error('Link not found or you are not the owner')
        }

        return link
    }

    // Get user's links with filters
    static async getUserLinks(phoneNumber, filter = 'all') {
        try {
            let query = supabase
                .from('whatsapp_links')
                .select('*')
                .or(`creator_phone.eq.${phoneNumber},target_phone.eq.${phoneNumber},temporal_target_phone.eq.${phoneNumber}`)
                .order('created_at', { ascending: false })

            if (filter === 'active') {
                query = query.eq('is_active', true)
            }

            const { data, error } = await query

            if (error) throw error

            return data || []
        } catch (error) {
            console.error('Error getting user links:', error.message)
            return []
        }
    }

    // Search links by phone number (as target OR creator)
    static async searchLinksByPhone(userPhone, searchPhone) {
        try {
            const formattedSearch = this.validatePhoneNumber(searchPhone)
            
            // Get links where searchPhone is the target
            const { data: asTarget, error: targetError } = await supabase
                .from('whatsapp_links')
                .select('*')
                .eq('creator_phone', userPhone)
                .eq('target_phone', formattedSearch)
                .order('created_at', { ascending: false })

            if (targetError) throw targetError

            // Get links where searchPhone is the creator
            const { data: asCreator, error: creatorError } = await supabase
                .from('whatsapp_links')
                .select('*')
                .eq('creator_phone', formattedSearch)
                .or(`target_phone.eq.${userPhone},temporal_target_phone.eq.${userPhone}`)
                .order('created_at', { ascending: false })

            if (creatorError) throw creatorError

            return {
                asTarget: asTarget || [],
                asCreator: asCreator || []
            }
        } catch (error) {
            console.error('Error searching links by phone:', error.message)
            return {
                asTarget: [],
                asCreator: []
            }
        }
    }

    // Get links by target number (backwards compatibility)
    static async getLinksByTarget(phoneNumber, targetPhone) {
        try {
            const formattedTarget = this.validatePhoneNumber(targetPhone)
            
            const { data, error } = await supabase
                .from('whatsapp_links')
                .select('*')
                .eq('creator_phone', phoneNumber)
                .eq('target_phone', formattedTarget)
                .order('created_at', { ascending: false })

            if (error) throw error

            return data || []
        } catch (error) {
            console.error('Error getting links by target:', error.message)
            return []
        }
    }

    // Get best performing links
    static async getBestPerformingLinks(phoneNumber, limit = 5) {
        try {
            const { data, error } = await supabase
                .from('whatsapp_links')
                .select('*')
                .eq('creator_phone', phoneNumber)
                .eq('is_active', true)
                .order('total_clicks', { ascending: false })
                .limit(limit)

            if (error) throw error

            return data || []
        } catch (error) {
            console.error('Error getting best performing links:', error.message)
            return []
        }
    }

    // Get lowest performing links
    static async getLowestPerformingLinks(phoneNumber, limit = 5) {
        try {
            const { data, error } = await supabase
                .from('whatsapp_links')
                .select('*')
                .eq('creator_phone', phoneNumber)
                .eq('is_active', true)
                .order('total_clicks', { ascending: true })
                .limit(limit)

            if (error) throw error

            return data || []
        } catch (error) {
            console.error('Error getting lowest performing links:', error.message)
            return []
        }
    }

    // Deactivate link
    static async deactivateLink(shortCode, reason = 'manual') {
        try {
            const normalizedCode = shortCode.toLowerCase()
            
            const { error } = await supabase
                .from('whatsapp_links')
                .update({ 
                    is_active: false,
                    deactivated_at: this.getCurrentTimestamp(),
                    deactivation_reason: reason,
                    updated_at: this.getCurrentTimestamp()
                })
                .eq('short_code', normalizedCode)

            if (error) throw error

            console.log(`Link deactivated: ${shortCode} (${reason})`)
            return true
        } catch (error) {
            console.error('Error deactivating link:', error.message)
            return false
        }
    }

    // Notify users about links expiring soon (6 hours warning)
    static async notifyExpiringLinks() {
        try {
            const eighteenHoursAgo = new Date(Date.now() - 18 * 60 * 60 * 1000)
            const seventeenHoursAgo = new Date(Date.now() - 17 * 60 * 60 * 1000)
            
            // Find links that were deactivated between 17-18 hours ago and haven't been warned
            const { data: expiringLinks, error } = await supabase
                .from('whatsapp_links')
                .select('*')
                .eq('is_active', false)
                .not('deactivated_at', 'is', null)
                .gte('deactivated_at', eighteenHoursAgo.toISOString())
                .lte('deactivated_at', seventeenHoursAgo.toISOString())
                .is('deletion_warning_sent', null)

            if (error) throw error
            
            if (!expiringLinks || expiringLinks.length === 0) {
                console.log('✅ No links need expiration warnings')
                return { notified: 0 }
            }

            console.log(`⚠️ Sending expiration warnings for ${expiringLinks.length} links`)

            let notifiedCount = 0
            for (const link of expiringLinks) {
                try {
                    const hoursLeft = Math.round((new Date(link.deactivated_at).getTime() + 24 * 60 * 60 * 1000 - Date.now()) / (60 * 60 * 1000))
                    
                    const message = `⚠️ *Link Expiring Soon!*\n\n` +
                        `Your link *${link.short_code}* will be permanently deleted in approximately *${hoursLeft} hours*.\n\n` +
                        `📊 *Current Stats:*\n` +
                        `• Total clicks: ${link.total_clicks}\n` +
                        `• Unique clicks: ${link.unique_clicks}\n` +
                        `• Target: ${link.target_phone}\n\n` +
                        `━━━━━━━━━━━━━━━━\n` +
                        `💡 *Want to keep it?*\n` +
                        `Reactivate now: *reactivate ${link.short_code}*\n\n` +
                        `Cost: ${this.PRICING.REACTIVATE_LINK} tums\n\n` +
                        `⚠️ After deletion, this link and all its data will be gone forever!`

                    const sent = await this.notifyUser(link.creator_phone, message)
                    
                    if (sent) {
                        // Mark as warned
                        await supabase
                            .from('whatsapp_links')
                            .update({ 
                                deletion_warning_sent: this.getCurrentTimestamp(),
                                updated_at: this.getCurrentTimestamp()
                            })
                            .eq('id', link.id)
                        
                        notifiedCount++
                    }
                } catch (error) {
                    console.error(`Error notifying about link ${link.short_code}:`, error.message)
                }
            }

            console.log(`✅ Sent ${notifiedCount} expiration warnings`)
            return { notified: notifiedCount }

        } catch (error) {
            console.error('❌ Error sending expiration warnings:', error.message)
            return { notified: 0 }
        }
    }

    // Delete inactive links that have been inactive for more than 24 hours
    static async deleteInactiveLinks() {
        try {
            const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
            
            // Find inactive links that were deactivated more than 24 hours ago
            const { data: linksToDelete, error: fetchError } = await supabase
                .from('whatsapp_links')
                .select('id, short_code, creator_phone, deactivated_at, total_clicks, unique_clicks, target_phone')
                .eq('is_active', false)
                .not('deactivated_at', 'is', null)
                .lte('deactivated_at', oneDayAgo.toISOString())

            if (fetchError) throw fetchError
            
            if (!linksToDelete || linksToDelete.length === 0) {
                console.log('✅ No inactive links to delete')
                return { deleted: 0, links: [] }
            }

            console.log(`🗑️ Found ${linksToDelete.length} inactive links to delete`)

            const deletedLinks = []
            
            for (const link of linksToDelete) {
                try {
                    // Send final notification before deletion
                    const finalMessage = `🗑️ *Link Deleted*\n\n` +
                        `Your inactive link *${link.short_code}* has been permanently deleted.\n\n` +
                        `📊 *Final Stats:*\n` +
                        `• Total clicks: ${link.total_clicks}\n` +
                        `• Unique clicks: ${link.unique_clicks}\n` +
                        `• Target: ${link.target_phone}\n\n` +
                        `━━━━━━━━━━━━━━━━\n` +
                        `💡 *Create a new link anytime:*\n` +
                        `create ${link.target_phone}\n\n` +
                        `💰 Cost: ${this.PRICING.CREATE_LINK} tums`

                    await this.notifyUser(link.creator_phone, finalMessage)

                    // Delete associated clicks first (foreign key constraint)
                    const { error: clicksError } = await supabase
                        .from('link_clicks')
                        .delete()
                        .eq('link_id', link.id)

                    if (clicksError) {
                        console.error(`❌ Error deleting clicks for ${link.short_code}:`, clicksError.message)
                        continue
                    }

                    // Delete the link
                    const { error: deleteError } = await supabase
                        .from('whatsapp_links')
                        .delete()
                        .eq('id', link.id)

                    if (deleteError) {
                        console.error(`❌ Error deleting link ${link.short_code}:`, deleteError.message)
                        continue
                    }

                    console.log(`🗑️ Deleted inactive link: ${link.short_code} (inactive since ${link.deactivated_at})`)
                    deletedLinks.push(link.short_code)

                } catch (error) {
                    console.error(`❌ Error processing link ${link.short_code}:`, error.message)
                }
            }

            console.log(`✅ Deleted ${deletedLinks.length} inactive links`)
            return { deleted: deletedLinks.length, links: deletedLinks }

        } catch (error) {
            console.error('❌ Error deleting inactive links:', error.message)
            throw error
        }
    }

    // Kill/delete link permanently
    static async killLink(phoneNumber, shortCode) {
        try {
            const normalizedCode = shortCode.toLowerCase()
            await this.verifyLinkOwnership(phoneNumber, normalizedCode)
            await this.deactivateLink(normalizedCode, 'killed_by_owner')
            
            console.log(`Link killed: ${shortCode}`)
            return { success: true, message: `Link ${shortCode} has been permanently killed` }

        } catch (error) {
            console.error('Error killing link:', error.message)
            throw error
        }
    }

    // FIXED: Process daily billing with notifications and cleanup
    // ===================================================================
    // SCALABLE DAILY BILLING - Uses database functions for speed
    // ===================================================================

    static async processDailyBilling() {
        try {
            console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━')
            console.log('⏰ Starting daily maintenance...')
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

            // STEP 1: Process billing (FAST - runs in database)
            console.log('💰 Processing billing...')
            const billingStart = Date.now()
            
            const { data: billingResult, error: billingError } = await supabase
                .rpc('process_daily_billing_batch')
            
            if (billingError) {
                console.error('❌ Billing error:', billingError.message)
                throw billingError
            }

            const result = billingResult[0]
            const billingTime = ((Date.now() - billingStart) / 1000).toFixed(2)
            
            console.log(`✅ Billing completed in ${billingTime}s:`)
            console.log(`   • Processed: ${result.processed} links`)
            console.log(`   • Deactivated: ${result.deactivated} links`)
            console.log(`   • Collected: ${result.total_collected} tums`)

            // STEP 2: Send deactivation notifications (async, don't block)
            if (result.deactivated > 0) {
                console.log('\n📤 Sending deactivation notifications...')
                this.sendDeactivationNotifications(result.deactivated_links)
                    .catch(err => console.error('Notification error:', err.message))
            }

            // STEP 3: Send 6-hour expiration warnings
            console.log('\n⚠️ Checking for expiration warnings...')
            const warningStart = Date.now()
            const warningResult = await this.notifyExpiringLinks()
            const warningTime = ((Date.now() - warningStart) / 1000).toFixed(2)
            console.log(`✅ Warnings sent in ${warningTime}s: ${warningResult.notified} notifications`)

            // STEP 4: Delete inactive links (24+ hours old)
            console.log('\n🗑️ Cleaning up inactive links...')
            const cleanupStart = Date.now()
            const cleanupResult = await this.deleteInactiveLinks()
            const cleanupTime = ((Date.now() - cleanupStart) / 1000).toFixed(2)
            console.log(`✅ Cleanup completed in ${cleanupTime}s: ${cleanupResult.deleted} links deleted`)

            console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━')
            console.log('✅ Daily maintenance completed!')
            console.log(`⏱️ Total time: ${((Date.now() - billingStart) / 1000).toFixed(2)}s`)
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

        } catch (error) {
            console.error('❌ Daily maintenance error:', error.message)
        }
    }

    // ===================================================================
    // SEND DEACTIVATION NOTIFICATIONS - Runs async, doesn't block billing
    // ===================================================================

    static async sendDeactivationNotifications(deactivatedLinksJson) {
        try {
            if (!deactivatedLinksJson || deactivatedLinksJson.length === 0) return

            let successCount = 0
            let failCount = 0

            // Process in small batches to avoid overwhelming WhatsApp API
            const BATCH_SIZE = 10
            
            for (let i = 0; i < deactivatedLinksJson.length; i += BATCH_SIZE) {
                const batch = deactivatedLinksJson.slice(i, i + BATCH_SIZE)
                
                await Promise.allSettled(
                    batch.map(async (linkJson) => {
                        try {
                            const link = JSON.parse(linkJson)
                            
                            const message = `⚠️ *Link Deactivated*\n\n` +
                                `Your link *${link.short_code}* was deactivated due to insufficient balance.\n\n` +
                                `💰 You need ${this.PRICING.DAILY_MAINTENANCE} tums for daily maintenance.\n` +
                                `Current balance: ${link.balance} tums\n\n` +
                                `📊 *Link Stats:*\n` +
                                `• Total clicks: ${link.total_clicks}\n` +
                                `• Unique clicks: ${link.unique_clicks}\n` +
                                `• Target: ${link.target_phone}\n\n` +
                                `━━━━━━━━━━━━━━━━\n` +
                                `⏰ *You have 24 hours to reactivate*\n\n` +
                                `1️⃣ Get tums: *coupon CODE*\n` +
                                `2️⃣ Reactivate: *reactivate ${link.short_code}*\n\n` +
                                `Cost to reactivate: ${this.PRICING.REACTIVATE_LINK} tums\n\n` +
                                `⚠️ After 24 hours, this link will be permanently deleted!`
                            
                            const sent = await this.notifyUser(link.creator_phone, message)
                            if (sent) successCount++
                            else failCount++
                            
                        } catch (err) {
                            console.error('Notification parse error:', err.message)
                            failCount++
                        }
                    })
                )
                
                // Small delay between batches
                if (i + BATCH_SIZE < deactivatedLinksJson.length) {
                    await new Promise(resolve => setTimeout(resolve, 500))
                }
            }

            console.log(`📤 Deactivation notifications: ${successCount} sent, ${failCount} failed`)

        } catch (error) {
            console.error('Error sending deactivation notifications:', error.message)
        }
    }

    // ===================================================================
    // NOTIFY EXPIRING LINKS - Optimized with database function
    // ===================================================================

    static async notifyExpiringLinks() {
        try {
            // Get expiring links from database function
            const { data: expiringLinks, error } = await supabase
                .rpc('get_expiring_links')

            if (error) throw error
            
            if (!expiringLinks || expiringLinks.length === 0) {
                return { notified: 0 }
            }

            console.log(`⚠️ Sending expiration warnings for ${expiringLinks.length} links`)

            let notifiedCount = 0
            
            // Send notifications in batches
            const BATCH_SIZE = 10
            
            for (let i = 0; i < expiringLinks.length; i += BATCH_SIZE) {
                const batch = expiringLinks.slice(i, i + BATCH_SIZE)
                
                const results = await Promise.allSettled(
                    batch.map(async (link) => {
                        try {
                            const hoursLeft = Math.round(
                                (new Date(link.deactivated_at).getTime() + 24 * 60 * 60 * 1000 - Date.now()) / 
                                (60 * 60 * 1000)
                            )
                            
                            const message = `⚠️ *Link Expiring Soon!*\n\n` +
                                `Your link *${link.short_code}* will be permanently deleted in approximately *${hoursLeft} hours*.\n\n` +
                                `📊 *Current Stats:*\n` +
                                `• Total clicks: ${link.total_clicks}\n` +
                                `• Unique clicks: ${link.unique_clicks}\n` +
                                `• Target: ${link.target_phone}\n\n` +
                                `━━━━━━━━━━━━━━━━\n` +
                                `💡 *Want to keep it?*\n` +
                                `Reactivate now: *reactivate ${link.short_code}*\n\n` +
                                `Cost: ${this.PRICING.REACTIVATE_LINK} tums\n\n` +
                                `⚠️ After deletion, this link and all its data will be gone forever!`

                            const sent = await this.notifyUser(link.creator_phone, message)
                            
                            if (sent) {
                                // Mark as warned
                                await supabase
                                    .from('whatsapp_links')
                                    .update({ 
                                        deletion_warning_sent: this.getCurrentTimestamp(),
                                        updated_at: this.getCurrentTimestamp()
                                    })
                                    .eq('short_code', link.short_code)
                                
                                return true
                            }
                            return false
                            
                        } catch (error) {
                            console.error(`Error notifying about link ${link.short_code}:`, error.message)
                            return false
                        }
                    })
                )
                
                notifiedCount += results.filter(r => r.status === 'fulfilled' && r.value).length
                
                // Small delay between batches
                if (i + BATCH_SIZE < expiringLinks.length) {
                    await new Promise(resolve => setTimeout(resolve, 500))
                }
            }

            return { notified: notifiedCount }

        } catch (error) {
            console.error('❌ Error sending expiration warnings:', error.message)
            return { notified: 0 }
        }
    }

    // ===================================================================
    // DELETE INACTIVE LINKS - Optimized with database function
    // ===================================================================

    static async deleteInactiveLinks() {
        try {
            // Get links ready for deletion
            const { data: linksToDelete, error: fetchError } = await supabase
                .rpc('get_links_for_deletion')

            if (fetchError) throw fetchError
            
            if (!linksToDelete || linksToDelete.length === 0) {
                return { deleted: 0, links: [] }
            }

            console.log(`🗑️ Found ${linksToDelete.length} inactive links to delete`)

            let totalDeleted = 0
            const deletedCodes = []
            
            // Send final notifications first (in batches)
            const NOTIFY_BATCH_SIZE = 10
            
            for (let i = 0; i < linksToDelete.length; i += NOTIFY_BATCH_SIZE) {
                const batch = linksToDelete.slice(i, i + NOTIFY_BATCH_SIZE)
                
                await Promise.allSettled(
                    batch.map(async (link) => {
                        const finalMessage = `🗑️ *Link Deleted*\n\n` +
                            `Your inactive link *${link.short_code}* has been permanently deleted.\n\n` +
                            `📊 *Final Stats:*\n` +
                            `• Total clicks: ${link.total_clicks}\n` +
                            `• Unique clicks: ${link.unique_clicks}\n` +
                            `• Target: ${link.target_phone}\n\n` +
                            `━━━━━━━━━━━━━━━━\n` +
                            `💡 *Create a new link anytime:*\n` +
                            `create ${link.target_phone}\n\n` +
                            `💰 Cost: ${this.PRICING.CREATE_LINK} tums`

                        await this.notifyUser(link.creator_phone, finalMessage)
                            .catch(err => console.error(`Notification failed: ${err.message}`))
                    })
                )
                
                if (i + NOTIFY_BATCH_SIZE < linksToDelete.length) {
                    await new Promise(resolve => setTimeout(resolve, 500))
                }
            }

            // Delete links in batches using database function
            const DELETE_BATCH_SIZE = 50
            
            for (let i = 0; i < linksToDelete.length; i += DELETE_BATCH_SIZE) {
                const batch = linksToDelete.slice(i, i + DELETE_BATCH_SIZE)
                const linkIds = batch.map(l => l.id)
                
                const { data: deletedCount, error: deleteError } = await supabase
                    .rpc('delete_links_batch', { link_ids: linkIds })
                
                if (deleteError) {
                    console.error('Batch deletion error:', deleteError.message)
                    continue
                }
                
                totalDeleted += deletedCount || 0
                deletedCodes.push(...batch.map(l => l.short_code))
                
                console.log(`🗑️ Deleted batch ${Math.floor(i / DELETE_BATCH_SIZE) + 1}: ${deletedCount} links`)
            }

            return { deleted: totalDeleted, links: deletedCodes }

        } catch (error) {
            console.error('❌ Error deleting inactive links:', error.message)
            return { deleted: 0, links: [] }
        }
    }
}

module.exports = LinkService