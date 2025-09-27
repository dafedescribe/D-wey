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
            console.log(`🔧 Creating link: ${creatorPhone} -> ${targetPhone}, custom: ${customShortCode}`)
            
            const creator = await UserService.getUserByPhone(creatorPhone)
            if (!creator || !creator.email) {
                throw new Error('Please register with email first')
            }

            let totalCost = this.TUMS_PRICING.CREATE_LINK
            if (customShortCode && customShortCode.trim()) {
                totalCost += this.TUMS_PRICING.CUSTOM_SHORTCODE
            }

            if (creator.wallet_balance < totalCost) {
                throw new Error(`Insufficient balance. Need ${totalCost} tums, you have ${creator.wallet_balance}`)
            }

            const formattedTargetPhone = this.validatePhoneNumber(targetPhone)

            let shortCode
            if (customShortCode && customShortCode.trim()) {
                shortCode = await this.generateCustomShortCode(customShortCode.trim())
            } else {
                shortCode = await this.generateUniqueShortCode()
            }

            const defaultMessage = customMessage || `Hello! I'd like to chat with you.`
            const whatsappUrl = `https://wa.me/${formattedTargetPhone}?text=${encodeURIComponent(defaultMessage)}`
            
            // TWO-HOP REDIRECT: First to our intermediate page, then to WhatsApp
            const redirectUrl = `${process.env.SHORT_DOMAIN || 'https://d-wey.com'}/${shortCode}`
            const weyUrl = `${process.env.SHORT_DOMAIN || 'https://d-wey.com'}/wey/${shortCode}`

            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)

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

            const { data: newLink, error } = await supabase
                .from('whatsapp_links')
                .insert([linkData])
                .select()
                .single()

            if (error) {
                throw new Error(`Database error: ${error.message}`)
            }

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

    // Handle custom short code
    static async generateCustomShortCode(requested) {
        const baseCode = requested.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
        
        if (baseCode.length < 3) {
            throw new Error('Custom short code must be at least 3 characters')
        }

        if (baseCode.length > 20) {
            throw new Error('Custom short code must be less than 20 characters')
        }

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

        // Try variations
        for (let i = 1; i <= 99; i++) {
            const variation = `${baseCode}${i}`
            
            const { data: existingVar, error: varError } = await supabase
                .from('whatsapp_links')
                .select('id')
                .eq('short_code', variation)
                .maybeSingle()

            if (varError) continue

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

            if (error) return null
            
            if (!data) return null

            // Check if expired
            if (new Date(data.expires_at) < new Date()) {
                await this.deactivateLink(shortCode, 'expired')
                return null
            }

            return data
            
        } catch (error) {
            console.error('❌ Error getting link:', error.message)
            return null
        }
    }

    // FIXED: Simplified click tracking with proper fingerprinting
    static async trackClick(linkId, ipAddress, userAgent, location = null) {
        try {
            console.log(`📊 Tracking click for link: ${linkId}`)
            
            // Create consistent fingerprint from IP + UserAgent + Date (to detect same-day duplicates)
            const today = new Date().toISOString().split('T')[0] // YYYY-MM-DD
            const fingerprint = crypto
                .createHash('sha256')
                .update(`${ipAddress}:${userAgent}:${today}`)
                .digest('hex')
            
            console.log(`🔍 Click fingerprint: ${fingerprint.substring(0, 12)}...`)

            // Check if this exact fingerprint clicked today
            const { data: existingClick, error: checkError } = await supabase
                .from('link_clicks')
                .select('id')
                .eq('link_id', linkId)
                .eq('click_fingerprint', fingerprint)
                .maybeSingle()

            if (checkError) {
                console.error('❌ Error checking existing click:', checkError)
            }

            const isUnique = !existingClick
            console.log(`🔄 Click is ${isUnique ? 'unique' : 'repeat'}`)

            // SIMPLIFIED: Only store essential data
            const clickData = {
                link_id: linkId,
                click_fingerprint: fingerprint,
                user_agent: userAgent,
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

            // Update link statistics
            const { data: currentLink, error: getCurrentError } = await supabase
                .from('whatsapp_links')
                .select('total_clicks, unique_clicks')
                .eq('id', linkId)
                .single()

            if (getCurrentError) {
                throw getCurrentError
            }

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

            console.log(`✅ Click tracked: ${linkId} (unique: ${isUnique})`)
            return { success: true, isUnique }

        } catch (error) {
            console.error('❌ Error tracking click:', error.message)
            return { success: false, isUnique: false }
        }
    }

    // IMPROVED: Store device info temporarily for wey verification
    static async storeDeviceForWeyCheck(shortCode, deviceInfo, ipAddress) {
        try {
            const verificationId = crypto.randomUUID()
            const expiresAt = new Date(Date.now() + 5 * 60 * 1000) // 5 minutes

            const tempData = {
                verification_id: verificationId,
                short_code: shortCode,
                device_info: JSON.stringify(deviceInfo),
                requester_ip: ipAddress,
                created_at: new Date().toISOString(),
                expires_at: expiresAt.toISOString()
            }

            const { error } = await supabase
                .from('temp_wey_requests')
                .insert([tempData])

            if (error) throw error

            console.log(`🔍 Stored device info for wey check: ${verificationId}`)
            return verificationId

        } catch (error) {
            console.error('❌ Error storing device info:', error.message)
            throw error
        }
    }

    // Track wey verification
    static async trackWeyCheck(linkId, verificationId, ipAddress, userAgent, location = null) {
        try {
            console.log(`🔍 Tracking wey check: ${linkId}, verification: ${verificationId}`)
            
            // Get stored device info
            const { data: tempData, error: tempError } = await supabase
                .from('temp_wey_requests')
                .select('*')
                .eq('verification_id', verificationId)
                .maybeSingle()

            if (tempError || !tempData) {
                console.log('⚠️ No temporary data found, proceeding without device info')
            }

            const deviceInfo = tempData ? JSON.parse(tempData.device_info) : this.parseUserAgent(userAgent)
            
            const checkData = {
                link_id: linkId,
                verification_id: verificationId,
                user_agent: userAgent,
                device_info: JSON.stringify(deviceInfo),
                location: location,
                checked_at: new Date().toISOString()
            }

            const { error: checkError } = await supabase
                .from('wey_checks')
                .insert([checkData])

            if (checkError) throw checkError

            // Update wey check count
            const { data: currentLink, error: getCurrentError } = await supabase
                .from('whatsapp_links')
                .select('wey_checks')
                .eq('id', linkId)
                .single()

            if (getCurrentError) throw getCurrentError

            const newWeyChecks = (currentLink.wey_checks || 0) + 1

            const { error: updateError } = await supabase
                .from('whatsapp_links')
                .update({ 
                    wey_checks: newWeyChecks,
                    last_wey_check_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                })
                .eq('id', linkId)

            if (updateError) throw updateError

            // Clean up temporary data
            if (tempData) {
                await supabase
                    .from('temp_wey_requests')
                    .delete()
                    .eq('verification_id', verificationId)
            }

            console.log(`✅ Wey check tracked: ${linkId}`)
            return { success: true, deviceInfo }

        } catch (error) {
            console.error('❌ Error tracking wey check:', error.message)
            return { success: false }
        }
    }

    // IMPROVED: Parse user agent with phone brand detection
    static parseUserAgent(userAgent) {
        const ua = userAgent.toLowerCase()
        
        // Device detection
        let device = 'desktop'
        let brand = 'unknown'
        let model = 'unknown'
        
        if (ua.includes('mobile') || ua.includes('android') || ua.includes('iphone')) {
            device = 'mobile'
            
            // Phone brand detection
            const brands = {
                'samsung': /samsung|sm-|galaxy/,
                'apple': /iphone|ipad/,
                'huawei': /huawei|honor|mate|p20|p30|p40/,
                'xiaomi': /xiaomi|redmi|mi |poco/,
                'oppo': /oppo|oneplus|realme/,
                'vivo': /vivo/,
                'tecno': /tecno/,
                'infinix': /infinix/,
                'itel': /itel/,
                'nokia': /nokia/,
                'motorola': /motorola|moto/,
                'google': /pixel/,
                'lg': /lg-/,
                'sony': /sony/
            }
            
            for (const [brandName, regex] of Object.entries(brands)) {
                if (regex.test(ua)) {
                    brand = brandName
                    break
                }
            }
            
            // Try to extract model
            if (brand === 'samsung' && ua.includes('sm-')) {
                const modelMatch = ua.match(/sm-([a-z0-9]+)/i)
                if (modelMatch) model = modelMatch[1].toUpperCase()
            } else if (brand === 'apple') {
                if (ua.includes('iphone')) model = 'iPhone'
                else if (ua.includes('ipad')) model = 'iPad'
            }
            
        } else if (ua.includes('tablet') || ua.includes('ipad')) {
            device = 'tablet'
            if (ua.includes('ipad')) {
                brand = 'apple'
                model = 'iPad'
            }
        }

        // Browser detection
        let browser = 'unknown'
        if (ua.includes('chrome') && !ua.includes('edge')) browser = 'chrome'
        else if (ua.includes('firefox')) browser = 'firefox'
        else if (ua.includes('safari') && !ua.includes('chrome')) browser = 'safari'
        else if (ua.includes('edge')) browser = 'edge'
        else if (ua.includes('opera')) browser = 'opera'
        else if (ua.includes('whatsapp')) browser = 'whatsapp'

        // OS detection
        let os = 'unknown'
        if (ua.includes('android')) os = 'android'
        else if (ua.includes('ios') || ua.includes('iphone') || ua.includes('ipad')) os = 'ios'
        else if (ua.includes('windows')) os = 'windows'
        else if (ua.includes('mac')) os = 'macos'
        else if (ua.includes('linux')) os = 'linux'

        return { 
            device, 
            brand: brand.charAt(0).toUpperCase() + brand.slice(1), 
            model, 
            browser, 
            os 
        }
    }

    // Generate wey verification report
    static async generateWeyReport(shortCode, deviceInfo, location, timestamp) {
        try {
            const { data: link, error } = await supabase
                .from('whatsapp_links')
                .select(`
                    short_code,
                    target_phone,
                    total_clicks,
                    unique_clicks,
                    wey_checks,
                    created_at,
                    last_clicked_at
                `)
                .eq('short_code', shortCode)
                .eq('is_active', true)
                .single()

            if (error || !link) {
                throw new Error('Link not found')
            }

            // Format device info
            const deviceName = deviceInfo.brand !== 'Unknown' 
                ? `${deviceInfo.brand}${deviceInfo.model !== 'unknown' ? ' ' + deviceInfo.model : ''}`
                : `${deviceInfo.device} device`

            // Format location
            const locationText = location && location !== 'Unknown Location' 
                ? location 
                : 'Unknown location'

            // Calculate link age
            const linkAge = Math.floor((new Date() - new Date(link.created_at)) / (1000 * 60 * 60 * 24))
            const lastClickTime = link.last_clicked_at 
                ? new Date(link.last_clicked_at).toLocaleString()
                : 'Never'

            let report = `🔍 *Link Verification Report*\n\n`
            report += `📱 *${deviceName}* user in *${locationText}*\n`
            report += `⏰ Requested at: ${new Date(timestamp).toLocaleString()}\n\n`
            report += `📊 *Link Statistics*\n`
            report += `• Total clicks: ${link.total_clicks || 0}\n`
            report += `• Unique visitors: ${link.unique_clicks || 0}\n`
            report += `• Verifications: ${link.wey_checks || 0}\n`
            report += `• Last clicked: ${lastClickTime}\n`
            report += `• Link age: ${linkAge} days\n\n`
            report += `🔗 Code: *${shortCode}*\n`
            report += `📱 Target: +${link.target_phone}\n\n`
            report += `_Verification completed by d-wey_`

            return report

        } catch (error) {
            console.error('❌ Error generating wey report:', error.message)
            throw error
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

            console.log(`🚫 Link deactivated: ${shortCode} (${reason})`)
            return true
        } catch (error) {
            console.error('❌ Error deactivating link:', error.message)
            return false
        }
    }

    // Get user's active links
    static async getUserLinks(phoneNumber) {
        try {
            const { data, error } = await supabase
                .from('whatsapp_links')
                .select('*')
                .eq('creator_phone', phoneNumber)
                .eq('is_active', true)
                .order('created_at', { ascending: false })

            if (error) throw error

            return data || []
        } catch (error) {
            console.error('❌ Error getting user links:', error.message)
            return []
        }
    }

    // Kill link permanently
    static async killLink(phoneNumber, shortCode) {
        try {
            const { data: link, error: getError } = await supabase
                .from('whatsapp_links')
                .select('*')
                .eq('short_code', shortCode)
                .eq('creator_phone', phoneNumber)
                .maybeSingle()

            if (getError) {
                throw new Error('Database error checking link ownership')
            }

            if (!link) {
                throw new Error('Link not found or you are not the owner')
            }

            await this.deactivateLink(shortCode, 'killed_by_owner')
            
            return { success: true, message: `Link ${shortCode} has been permanently killed` }

        } catch (error) {
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
                console.log('💰 No links need billing')
                return
            }

            console.log(`💰 Processing daily billing for ${linksToBill.length} links`)

            for (const link of linksToBill) {
                try {
                    const creator = await UserService.getUserByPhone(link.creator_phone)
                    
                    if (!creator || creator.wallet_balance < this.TUMS_PRICING.DAILY_MAINTENANCE) {
                        await this.deactivateLink(link.short_code, 'insufficient_balance')
                        continue
                    }

                    await UserService.deductFromWallet(
                        link.creator_phone,
                        this.TUMS_PRICING.DAILY_MAINTENANCE,
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

                } catch (error) {
                    console.error(`❌ Error billing link ${link.short_code}:`, error.message)
                }
            }

        } catch (error) {
            console.error('❌ Error processing daily billing:', error.message)
        }
    }

    // Clean up expired temporary wey requests
    static async cleanupExpiredWeyRequests() {
        try {
            const { error } = await supabase
                .from('temp_wey_requests')
                .delete()
                .lt('expires_at', new Date().toISOString())

            if (error) {
                console.error('❌ Error cleaning up expired wey requests:', error)
            } else {
                console.log('🧹 Cleaned up expired wey requests')
            }
        } catch (error) {
            console.error('❌ Error in cleanup:', error.message)
        }
    }
}

// Run cleanup every 10 minutes
setInterval(() => {
    LinkService.cleanupExpiredWeyRequests()
}, 10 * 60 * 1000)

module.exports = LinkService