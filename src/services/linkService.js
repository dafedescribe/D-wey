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

    // Hash cookie/browser fingerprint
    static hashCookie(cookieData) {
        return crypto.createHash('sha256').update(cookieData).digest('hex')
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

            // Create link record
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
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
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
            const shortCode = this.generateShortCode()
            
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
        const baseCode = requested.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
        
        if (baseCode.length < 3) {
            throw new Error('Custom short code must be at least 3 characters')
        }

        if (baseCode.length > 20) {
            throw new Error('Custom short code must be less than 20 characters')
        }

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
            const { data, error } = await supabase
                .from('whatsapp_links')
                .select('*')
                .eq('short_code', shortCode)
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
                await this.deactivateLink(shortCode, 'expired')
                return null
            }

            return data
            
        } catch (error) {
            console.error('Error getting link:', error.message)
            return null
        }
    }

    // Track click on redirect link
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

            // Create click record
            const clickData = {
                link_id: linkId,
                hashed_ip: hashedIP,
                hashed_cookie: hashedCookie,
                is_unique: isUnique,
                clicked_at: new Date().toISOString()
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
                    last_clicked_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
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
            // Verify ownership
            const link = await this.verifyLinkOwnership(phoneNumber, shortCode)
            
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

            // Update link with temporal target
            const { error } = await supabase
                .from('whatsapp_links')
                .update({
                    temporal_target_phone: formattedTemporalPhone,
                    temporal_whatsapp_url: temporalWhatsappUrl,
                    temporal_set_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                })
                .eq('short_code', shortCode)
                .eq('creator_phone', phoneNumber)

            if (error) throw error

            // Deduct tums
            await UserService.deductFromWallet(
                phoneNumber,
                this.PRICING.SET_TEMPORAL_TARGET,
                `Temporal target set for ${shortCode}`
            )

            console.log(`Temporal target set: ${shortCode} -> ${formattedTemporalPhone}`)
            return { success: true, temporalTarget: formattedTemporalPhone }

        } catch (error) {
            console.error('Error setting temporal target:', error.message)
            throw error
        }
    }

    // Kill temporal target number
    static async killTemporalTarget(phoneNumber, shortCode) {
        try {
            // Verify ownership
            const link = await this.verifyLinkOwnership(phoneNumber, shortCode)
            
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
                    updated_at: new Date().toISOString()
                })
                .eq('short_code', shortCode)
                .eq('creator_phone', phoneNumber)

            if (error) throw error

            // Deduct tums
            await UserService.deductFromWallet(
                phoneNumber,
                this.PRICING.KILL_TEMPORAL_TARGET,
                `Temporal target killed for ${shortCode}`
            )

            console.log(`Temporal target killed: ${shortCode}`)
            return { success: true }

        } catch (error) {
            console.error('Error killing temporal target:', error.message)
            throw error
        }
    }

    // Get link info with analytics (costs 10 tums)
    static async getLinkInfo(phoneNumber, shortCode) {
        try {
            // Get link
            const { data: link, error: linkError } = await supabase
                .from('whatsapp_links')
                .select('*')
                .eq('short_code', shortCode)
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
                `Link info check - ${shortCode}`
            )

            // Get click analytics
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

    // Get link analytics
    static async getLinkAnalytics(linkId) {
        try {
            const { data: clicks, error } = await supabase
                .from('link_clicks')
                .select('clicked_at')
                .eq('link_id', linkId)
                .order('clicked_at', { ascending: true })

            if (error) throw error

            if (!clicks || clicks.length === 0) {
                return {
                    peakTime: 'No data yet',
                    clicksByHour: {},
                    firstClick: null,
                    lastClick: null
                }
            }

            // Calculate clicks by hour
            const clicksByHour = {}
            clicks.forEach(click => {
                const hour = new Date(click.clicked_at).getHours()
                clicksByHour[hour] = (clicksByHour[hour] || 0) + 1
            })

            // Find peak hour
            let peakHour = 0
            let maxClicks = 0
            Object.entries(clicksByHour).forEach(([hour, count]) => {
                if (count > maxClicks) {
                    maxClicks = count
                    peakHour = parseInt(hour)
                }
            })

            return {
                peakTime: `${peakHour}:00 - ${peakHour + 1}:00`,
                clicksByHour,
                firstClick: clicks[0].clicked_at,
                lastClick: clicks[clicks.length - 1].clicked_at
            }

        } catch (error) {
            console.error('Error getting analytics:', error.message)
            return null
        }
    }

    // Verify link ownership
    static async verifyLinkOwnership(phoneNumber, shortCode) {
        const { data: link, error } = await supabase
            .from('whatsapp_links')
            .select('*')
            .eq('short_code', shortCode)
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
            const { error } = await supabase
                .from('whatsapp_links')
                .update({ 
                    is_active: false,
                    deactivated_at: new Date().toISOString(),
                    deactivation_reason: reason,
                    updated_at: new Date().toISOString()
                })
                .eq('short_code', shortCode)

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
            await this.verifyLinkOwnership(phoneNumber, shortCode)
            await this.deactivateLink(shortCode, 'killed_by_owner')
            
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
                            next_billing_at: nextBilling.toISOString(),
                            expires_at: nextBilling.toISOString(),
                            updated_at: new Date().toISOString()
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