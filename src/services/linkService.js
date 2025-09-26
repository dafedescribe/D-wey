const { supabase } = require('../config/database')
const crypto = require('crypto')
const UserService = require('./userService')

class LinkService {
    static TUMS_PRICING = {
        CREATE_LINK: 50,           // Create new redirect link
        CUSTOM_SHORTCODE: 200,     // Set custom short code
        DAILY_MAINTENANCE: 10,     // Daily cost to keep link active
        ANALYTICS_REPORT: 20,      // Generate analytics report
        THIRD_PARTY_CHECK: 5       // Third party verification
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

    // Validate phone number format
    static validatePhoneNumber(phoneNumber) {
        // Remove all non-numeric characters
        const cleanNumber = phoneNumber.replace(/\D/g, '')
        
        // Check if it's a valid length (10-15 digits)
        if (cleanNumber.length < 10 || cleanNumber.length > 15) {
            throw new Error('Phone number must be between 10-15 digits')
        }
        
        // Ensure it starts with country code or add default
        if (cleanNumber.startsWith('0')) {
            return '234' + cleanNumber.substring(1) // Nigerian number
        } else if (cleanNumber.startsWith('234')) {
            return cleanNumber
        } else if (cleanNumber.length === 10) {
            return '234' + cleanNumber // Assume Nigerian
        }
        
        return cleanNumber
    }

    // Create WhatsApp redirect link - FIXED VERSION
    static async createWhatsAppLink(creatorPhone, targetPhone, customShortCode = null, customMessage = null) {
        try {
            console.log(`🔧 Creating link: ${creatorPhone} -> ${targetPhone}, custom: ${customShortCode}`)
            
            // Validate creator exists and has sufficient balance
            const creator = await UserService.getUserByPhone(creatorPhone)
            if (!creator || !creator.email) {
                throw new Error('Please register with email first')
            }

            // Calculate total cost - FIXED LOGIC
            let totalCost = this.TUMS_PRICING.CREATE_LINK
            if (customShortCode && customShortCode.trim()) {
                totalCost += this.TUMS_PRICING.CUSTOM_SHORTCODE
                console.log(`💰 Custom shortcode requested, total cost: ${totalCost}`)
            }

            if (creator.wallet_balance < totalCost) {
                throw new Error(`Insufficient balance. Need ${totalCost} tums, you have ${creator.wallet_balance}`)
            }

            // Validate and format target phone number
            const formattedTargetPhone = this.validatePhoneNumber(targetPhone)

            // Handle short code generation/validation - FIXED
            let shortCode
            if (customShortCode && customShortCode.trim()) {
                console.log(`🏷️ Processing custom shortcode: ${customShortCode}`)
                shortCode = await this.generateCustomShortCode(customShortCode.trim())
            } else {
                console.log(`🎲 Generating random shortcode`)
                shortCode = await this.generateUniqueShortCode()
            }

            console.log(`✅ Final shortcode: ${shortCode}`)

            // Create default message if none provided
            const defaultMessage = customMessage || `Hello! I'd like to chat with you.`
            
            // Generate WhatsApp URL
            const whatsappUrl = `https://wa.me/${formattedTargetPhone}?text=${encodeURIComponent(defaultMessage)}`
            
            // Create redirect and wey links
            const redirectUrl = `${process.env.SHORT_DOMAIN || 'https://d-wey.com'}/${shortCode}`
            const weyUrl = `${process.env.SHORT_DOMAIN || 'https://d-wey.com'}/wey/${shortCode}`

            // Calculate expiration (24 hours from now)
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)

            // Create link record - FIXED DATA STRUCTURE
            const linkData = {
                creator_phone: creatorPhone,
                target_phone: formattedTargetPhone,
                whatsapp_url: whatsappUrl,
                short_code: shortCode,
                redirect_url: redirectUrl,
                wey_url: weyUrl,
                custom_message: customMessage,
                is_custom_shortcode: !!(customShortCode && customShortCode.trim()),
                total_clicks: 0,
                unique_clicks: 0,
                wey_checks: 0,
                is_active: true,
                expires_at: expiresAt.toISOString(),
                next_billing_at: expiresAt.toISOString(),
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            }

            console.log(`💾 Inserting link data:`, {
                short_code: linkData.short_code,
                creator_phone: linkData.creator_phone,
                target_phone: linkData.target_phone,
                is_custom: linkData.is_custom_shortcode
            })

            const { data: newLink, error } = await supabase
                .from('whatsapp_links')
                .insert([linkData])
                .select()
                .single()

            if (error) {
                console.error(`❌ Database insert error:`, error)
                throw new Error(`Database error: ${error.message}`)
            }

            console.log(`✅ Link created in database:`, newLink.id)

            // Deduct tums from creator's balance
            await UserService.deductFromWallet(
                creatorPhone, 
                totalCost, 
                `WhatsApp link created (${shortCode})`
            )

            console.log(`🔗 WhatsApp link created: ${shortCode} -> ${formattedTargetPhone}, cost: ${totalCost}`)
            
            return {
                link: newLink,
                redirectUrl,
                weyUrl,
                shortCode,
                cost: totalCost,
                expiresAt
            }

        } catch (error) {
            console.error('❌ Error creating WhatsApp link:', error.message)
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
                console.error('❌ Error checking shortcode uniqueness:', error)
                attempts++
                continue
            }

            if (!existing) {
                console.log(`✅ Generated unique shortcode: ${shortCode}`)
                return shortCode
            }
            attempts++
        }

        throw new Error('Failed to generate unique short code')
    }

    // Handle custom short code with smart variations - FIXED
    static async generateCustomShortCode(requested) {
        const baseCode = requested.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
        
        if (baseCode.length < 3) {
            throw new Error('Custom short code must be at least 3 characters')
        }

        if (baseCode.length > 20) {
            throw new Error('Custom short code must be less than 20 characters')
        }

        console.log(`🔍 Checking custom shortcode: ${baseCode}`)

        // Try original first
        const { data: existing, error } = await supabase
            .from('whatsapp_links')
            .select('id')
            .eq('short_code', baseCode)
            .maybeSingle()

        if (error) {
            console.error('❌ Error checking custom shortcode:', error)
            throw new Error('Database error checking shortcode availability')
        }

        if (!existing) {
            console.log(`✅ Custom shortcode available: ${baseCode}`)
            return baseCode
        }

        console.log(`⚠️ Shortcode taken, trying variations of: ${baseCode}`)

        // Try variations: baseCode1, baseCode2, etc.
        for (let i = 1; i <= 99; i++) {
            const variation = `${baseCode}${i}`
            
            const { data: existingVar, error: varError } = await supabase
                .from('whatsapp_links')
                .select('id')
                .eq('short_code', variation)
                .maybeSingle()

            if (varError) {
                console.error('❌ Error checking variation:', varError)
                continue
            }

            if (!existingVar) {
                console.log(`✅ Found available variation: ${variation}`)
                return variation
            }
        }

        throw new Error(`Custom short code '${requested}' and variations are taken`)
    }

    // Get link by short code - FIXED
    static async getLinkByShortCode(shortCode) {
        try {
            console.log(`🔍 Looking up shortcode: ${shortCode}`)
            
            const { data, error } = await supabase
                .from('whatsapp_links')
                .select('*')
                .eq('short_code', shortCode)
                .eq('is_active', true)
                .maybeSingle()

            if (error) {
                console.error('❌ Error getting link:', error)
                return null
            }
            
            if (!data) {
                console.log(`❌ Link not found: ${shortCode}`)
                return null
            }

            // Check if link is expired
            if (new Date(data.expires_at) < new Date()) {
                console.log(`⏰ Link expired: ${shortCode}`)
                await this.deactivateLink(shortCode, 'expired')
                return null
            }

            console.log(`✅ Link found: ${shortCode} -> ${data.target_phone}`)
            return data
            
        } catch (error) {
            console.error('❌ Error getting link:', error.message)
            return null
        }
    }

    // Track click on redirect link - FIXED SUPABASE.RAW ISSUE
    static async trackClick(linkId, ipAddress, userAgent, location = null) {
        try {
            console.log(`📊 Tracking click for link: ${linkId}`)
            
            // Hash IP for privacy
            const hashedIp = crypto.createHash('sha256').update(ipAddress).digest('hex')
            
            // Check if this hashed IP has clicked before (for unique tracking)
            const { data: existingClick, error: checkError } = await supabase
                .from('link_clicks')
                .select('id')
                .eq('link_id', linkId)
                .eq('hashed_ip', hashedIp)
                .maybeSingle()

            if (checkError) {
                console.error('❌ Error checking existing click:', checkError)
            }

            const isUnique = !existingClick
            console.log(`🔄 Click is ${isUnique ? 'unique' : 'repeat'}`)

            // Parse device and browser info
            const deviceInfo = this.parseUserAgent(userAgent)

            // Create click record
            const clickData = {
                link_id: linkId,
                hashed_ip: hashedIp,
                user_agent: userAgent,
                device_type: deviceInfo.device,
                browser: deviceInfo.browser,
                operating_system: deviceInfo.os,
                location: location,
                is_unique: isUnique,
                clicked_at: new Date().toISOString()
            }

            const { error: clickError } = await supabase
                .from('link_clicks')
                .insert([clickData])

            if (clickError) {
                console.error('❌ Error inserting click:', clickError)
                throw clickError
            }

            console.log('✅ Click record inserted')

            // Update link statistics - FIXED: NO MORE supabase.raw()
            // Get current values first
            const { data: currentLink, error: getCurrentError } = await supabase
                .from('whatsapp_links')
                .select('total_clicks, unique_clicks')
                .eq('id', linkId)
                .single()

            if (getCurrentError) {
                console.error('❌ Error getting current link stats:', getCurrentError)
                throw getCurrentError
            }

            // Calculate new values
            const newTotalClicks = (currentLink.total_clicks || 0) + 1
            const newUniqueClicks = (currentLink.unique_clicks || 0) + (isUnique ? 1 : 0)

            console.log(`📈 Updating stats: ${currentLink.total_clicks} -> ${newTotalClicks}, unique: ${currentLink.unique_clicks} -> ${newUniqueClicks}`)

            // Update with calculated values
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
                console.error('❌ Error updating link stats:', updateError)
                throw updateError
            }

            console.log(`✅ Click tracked successfully: ${linkId} (unique: ${isUnique})`)
            return { success: true, isUnique }

        } catch (error) {
            console.error('❌ Error tracking click:', error.message)
            return { success: false, isUnique: false }
        }
    }

    // Track wey link checks - FIXED
    static async trackWeyCheck(linkId, ipAddress, userAgent, location = null) {
        try {
            console.log(`🔍 Tracking wey check for link: ${linkId}`)
            
            const hashedIp = crypto.createHash('sha256').update(ipAddress).digest('hex')
            const deviceInfo = this.parseUserAgent(userAgent)

            const checkData = {
                link_id: linkId,
                hashed_ip: hashedIp,
                user_agent: userAgent,
                device_type: deviceInfo.device,
                browser: deviceInfo.browser,
                operating_system: deviceInfo.os,
                location: location,
                checked_at: new Date().toISOString()
            }

            const { error: checkError } = await supabase
                .from('wey_checks')
                .insert([checkData])

            if (checkError) {
                console.error('❌ Error inserting wey check:', checkError)
                throw checkError
            }

            // Update wey check count - FIXED: NO MORE supabase.raw()
            const { data: currentLink, error: getCurrentError } = await supabase
                .from('whatsapp_links')
                .select('wey_checks')
                .eq('id', linkId)
                .single()

            if (getCurrentError) {
                console.error('❌ Error getting current wey checks:', getCurrentError)
                throw getCurrentError
            }

            const newWeyChecks = (currentLink.wey_checks || 0) + 1

            const { error: updateError } = await supabase
                .from('whatsapp_links')
                .update({ 
                    wey_checks: newWeyChecks,
                    last_wey_check_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                })
                .eq('id', linkId)

            if (updateError) {
                console.error('❌ Error updating wey check count:', updateError)
                throw updateError
            }

            console.log(`✅ Wey check tracked: ${linkId}`)
            return { success: true, deviceInfo, hashedIp }

        } catch (error) {
            console.error('❌ Error tracking wey check:', error.message)
            return { success: false }
        }
    }

    // Parse user agent for device information
    static parseUserAgent(userAgent) {
        const ua = userAgent.toLowerCase()
        
        // Device detection
        let device = 'desktop'
        if (ua.includes('mobile') || ua.includes('android') || ua.includes('iphone')) {
            device = 'mobile'
        } else if (ua.includes('tablet') || ua.includes('ipad')) {
            device = 'tablet'
        }

        // Browser detection
        let browser = 'unknown'
        if (ua.includes('chrome')) browser = 'chrome'
        else if (ua.includes('firefox')) browser = 'firefox'
        else if (ua.includes('safari') && !ua.includes('chrome')) browser = 'safari'
        else if (ua.includes('edge')) browser = 'edge'
        else if (ua.includes('opera')) browser = 'opera'

        // OS detection
        let os = 'unknown'
        if (ua.includes('windows')) os = 'windows'
        else if (ua.includes('mac')) os = 'macos'
        else if (ua.includes('android')) os = 'android'
        else if (ua.includes('ios') || ua.includes('iphone') || ua.includes('ipad')) os = 'ios'
        else if (ua.includes('linux')) os = 'linux'

        return { device, browser, os }
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

            console.log(`🚫 Link deactivated: ${shortCode} (${reason})`)
            return true
        } catch (error) {
            console.error('❌ Error deactivating link:', error.message)
            return false
        }
    }

    // Get user's active links - FIXED
    static async getUserLinks(phoneNumber) {
        try {
            console.log(`🔍 Getting links for user: ${phoneNumber}`)
            
            const { data, error } = await supabase
                .from('whatsapp_links')
                .select('*')
                .eq('creator_phone', phoneNumber)
                .eq('is_active', true)
                .order('created_at', { ascending: false })

            if (error) {
                console.error('❌ Error getting user links:', error)
                throw error
            }

            console.log(`✅ Found ${data?.length || 0} active links for user: ${phoneNumber}`)
            return data || []
        } catch (error) {
            console.error('❌ Error getting user links:', error.message)
            return []
        }
    }

    // Kill/delete link permanently
    static async killLink(phoneNumber, shortCode) {
        try {
            console.log(`🚫 Killing link: ${shortCode} by user: ${phoneNumber}`)
            
            // Verify ownership
            const { data: link, error: getError } = await supabase
                .from('whatsapp_links')
                .select('*')
                .eq('short_code', shortCode)
                .eq('creator_phone', phoneNumber)
                .maybeSingle()

            if (getError) {
                console.error('❌ Error checking link ownership:', getError)
                throw new Error('Database error checking link ownership')
            }

            if (!link) {
                throw new Error('Link not found or you are not the owner')
            }

            // Deactivate the link
            await this.deactivateLink(shortCode, 'killed_by_owner')
            
            console.log(`✅ Link killed: ${shortCode}`)
            return { success: true, message: `Link ${shortCode} has been permanently killed` }

        } catch (error) {
            console.error('❌ Error killing link:', error.message)
            throw error
        }
    }

    // Process daily billing for active links - FIXED
    static async processDailyBilling() {
        try {
            const now = new Date()
            
            // Get all active links that need billing
            const { data: linksToBill, error } = await supabase
                .from('whatsapp_links')
                .select('*')
                .eq('is_active', true)
                .lte('next_billing_at', now.toISOString())

            if (error) throw error
            if (!linksToBill || linksToBill.length === 0) {
                console.log('💰 No links need billing')
                return
            }

            console.log(`💰 Processing daily billing for ${linksToBill.length} links`)

            for (const link of linksToBill) {
                try {
                    const creator = await UserService.getUserByPhone(link.creator_phone)
                    
                    if (!creator || creator.wallet_balance < this.TUMS_PRICING.DAILY_MAINTENANCE) {
                        // Insufficient balance - deactivate link
                        await this.deactivateLink(link.short_code, 'insufficient_balance')
                        console.log(`🚫 Link ${link.short_code} deactivated - insufficient balance`)
                        continue
                    }

                    // Deduct daily maintenance fee
                    await UserService.deductFromWallet(
                        link.creator_phone,
                        this.TUMS_PRICING.DAILY_MAINTENANCE,
                        `Daily maintenance - ${link.short_code}`
                    )

                    // Update next billing date
                    const nextBilling = new Date(now.getTime() + 24 * 60 * 60 * 1000)
                    await supabase
                        .from('whatsapp_links')
                        .update({ 
                            next_billing_at: nextBilling.toISOString(),
                            expires_at: nextBilling.toISOString(),
                            updated_at: new Date().toISOString()
                        })
                        .eq('id', link.id)

                    console.log(`✅ Billed ${link.short_code} - ${this.TUMS_PRICING.DAILY_MAINTENANCE} tums`)

                } catch (error) {
                    console.error(`❌ Error billing link ${link.short_code}:`, error.message)
                }
            }

        } catch (error) {
            console.error('❌ Error processing daily billing:', error.message)
        }
    }
}

module.exports = LinkService