const { supabase } = require('../config/database')
const crypto = require('crypto')
const UserService = require('./userService')

class LinkService {
    static PRICING = {
        CREATE_LINK: 250,
        DAILY_MAINTENANCE: 20,
        LINK_INFO_CHECK: 10,
        SET_TEMPORAL_TARGET: 10,
        KILL_TEMPORAL_TARGET: 10
    }

    // Convert UTC date to Nigeria time (WAT - UTC+1)
    static toNigeriaTime(date = new Date()) {
        // Nigeria is UTC+1 (West Africa Time)
        const utcDate = new Date(date)
        const nigeriaOffset = 60 // minutes
        const nigeriaTime = new Date(utcDate.getTime() + nigeriaOffset * 60 * 1000)
        return nigeriaTime.toISOString()
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
            
            // Generate WhatsApp URL
            const whatsappUrl = `https://wa.me/${formattedTargetPhone}?text=${encodeURIComponent(defaultMessage)}`
            
            // Create redirect link
            const redirectUrl = `${process.env.SHORT_DOMAIN || 'https://d-wey.com'}/${shortCode}`

            // Calculate expiration (24 hours from now)
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)

            // Create link record with Nigeria time
            const nigeriaTime = this.toNigeriaTime()
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
                expires_at: this.toNigeriaTime(expiresAt),
                next_billing_at: this.toNigeriaTime(expiresAt),
                created_at: nigeriaTime,
                updated_at: nigeriaTime
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

    // Track click on redirect link with Nigeria time
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

            // Create click record with Nigeria time
            const clickData = {
                link_id: linkId,
                hashed_ip: hashedIP,
                hashed_cookie: hashedCookie,
                is_unique: isUnique,
                clicked_at: this.toNigeriaTime()
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

            // Update link statistics with Nigeria time
            const newTotalClicks = (currentLink.total_clicks || 0) + 1
            const newUniqueClicks = (currentLink.unique_clicks || 0) + (isUnique ? 1 : 0)

            const { error: updateError } = await supabase
                .from('whatsapp_links')
                .update({ 
                    total_clicks: newTotalClicks,
                    unique_clicks: newUniqueClicks,
                    last_clicked_at: this.toNigeriaTime(),
                    updated_at: this.toNigeriaTime()
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

            // Update temporal target URL
            const temporalMessage = link.custom_message || `Hello! I'd like to chat with you.`
            const temporalWhatsappUrl = `https://wa.me/${formattedTemporalPhone}?text=${encodeURIComponent(temporalMessage)}`

            // Update link with temporal target (Nigeria time)
            const { error } = await supabase
                .from('whatsapp_links')
                .update({
                    temporal_target_phone: formattedTemporalPhone,
                    temporal_whatsapp_url: temporalWhatsappUrl,
                    temporal_set_at: this.toNigeriaTime(),
                    updated_at: this.toNigeriaTime()
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
                    updated_at: this.toNigeriaTime()
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

    // Get comprehensive link analytics (all dates in Nigeria time)
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

            // Process all clicks (convert to Nigeria time for analysis)
            clicks.forEach(click => {
                // Parse as Nigeria time
                const date = new Date(click.clicked_at)
                
                // Hour analysis (0-23) in Nigeria time
                const hour = parseInt(date.toLocaleString('en-US', { 
                    timeZone: 'Africa/Lagos', 
                    hour: '2-digit', 
                    hour12: false 
                }))
                clicksByHour[hour] = (clicksByHour[hour] || 0) + 1
                
                // Day analysis (YYYY-MM-DD) in Nigeria time
                const dayKey = date.toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' })
                clicksByDay[dayKey] = (clicksByDay[dayKey] || 0) + 1
                
                // Day of week analysis in Nigeria time
                const dayOfWeek = date.toLocaleDateString('en-US', { 
                    timeZone: 'Africa/Lagos', 
                    weekday: 'long' 
                })
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
            const formattedPeakDay = peakDay ? new Date(peakDay).toLocaleDateString('en-GB', {
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
                
                // Timeline (Nigeria time)
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

    // Get links by target number
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
                    deactivated_at: this.toNigeriaTime(),
                    deactivation_reason: reason,
                    updated_at: this.toNigeriaTime()
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

    // Process daily billing
    static async processDailyBilling() {
        try {
            const now = new Date()
            
            const { data: linksToBill, error } = await supabase
                .from('whatsapp_links')
                .select('*')
                .eq('is_active', true)
                .lte('next_billing_at', now.toISOString())

            if (error) throw error
            if (!linksToBill || linksToBill.length === 0) {
                console.log('No links need billing')
                return
            }

            console.log(`Processing daily billing for ${linksToBill.length} links`)

            for (const link of linksToBill) {
                try {
                    const creator = await UserService.getUserByPhone(link.creator_phone)
                    
                    if (!creator || creator.wallet_balance < this.PRICING.DAILY_MAINTENANCE) {
                        await this.deactivateLink(link.short_code, 'insufficient_balance')
                        console.log(`Link ${link.short_code} deactivated - insufficient balance`)
                        continue
                    }

                    await UserService.deductFromWallet(
                        link.creator_phone,
                        this.PRICING.DAILY_MAINTENANCE,
                        `Daily maintenance - ${link.short_code}`
                    )

                    const nextBilling = new Date(now.getTime() + 24 * 60 * 60 * 1000)
                    await supabase
                        .from('whatsapp_links')
                        .update({ 
                            next_billing_at: this.toNigeriaTime(nextBilling),
                            expires_at: this.toNigeriaTime(nextBilling),
                            updated_at: this.toNigeriaTime()
                        })
                        .eq('id', link.id)

                    console.log(`Billed ${link.short_code} - ${this.PRICING.DAILY_MAINTENANCE} tums`)

                } catch (error) {
                    console.error(`Error billing link ${link.short_code}:`, error.message)
                }
            }

        } catch (error) {
            console.error('Error processing daily billing:', error.message)
        }
    }
}

module.exports = LinkService