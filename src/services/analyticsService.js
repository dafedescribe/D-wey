const { supabase } = require('../config/database')
const UserService = require('./userService')

class AnalyticsService {
    // Generate simplified analytics report
    static async generateAnalyticsReport(phoneNumber, shortCode) {
        try {
            console.log(`📊 Generating analytics for ${shortCode} by ${phoneNumber}`)
            
            // Check if user has sufficient balance
            const user = await UserService.getUserByPhone(phoneNumber)
            if (!user || user.wallet_balance < 20) {
                throw new Error(`Insufficient balance. Need 20 tums for analytics report`)
            }

            // Get link data with ownership verification
            const { data: link, error: linkError } = await supabase
                .from('whatsapp_links')
                .select('*')
                .eq('short_code', shortCode)
                .eq('creator_phone', phoneNumber)
                .eq('is_active', true)
                .maybeSingle()

            if (linkError) {
                throw new Error(`Database error: ${linkError.message}`)
            }

            if (!link) {
                throw new Error('Link not found or you are not the owner')
            }

            // Get simplified analytics data
            const analytics = await this.getSimplifiedAnalytics(link.id)
            
            // Deduct cost from user balance
            await UserService.deductFromWallet(
                phoneNumber,
                20, // ANALYTICS_REPORT cost
                `Analytics report - ${shortCode}`
            )

            // Compile simplified report
            const report = this.compileSimplifiedReport(link, analytics)
            
            console.log(`📊 Analytics report generated for ${shortCode}`)
            return report

        } catch (error) {
            console.error('❌ Error generating analytics report:', error.message)
            throw error
        }
    }

    // Get simplified analytics data
    static async getSimplifiedAnalytics(linkId) {
        try {
            console.log(`📈 Getting analytics for link: ${linkId}`)
            
            // Get all clicks
            const { data: clicks, error: clicksError } = await supabase
                .from('link_clicks')
                .select(`
                    clicked_at,
                    is_unique,
                    location,
                    user_agent
                `)
                .eq('link_id', linkId)
                .order('clicked_at', { ascending: true })

            if (clicksError) {
                console.error('❌ Error getting clicks:', clicksError)
            }

            // Get all wey checks
            const { data: weyChecks, error: checksError } = await supabase
                .from('wey_checks')
                .select(`
                    checked_at,
                    location,
                    device_info
                `)
                .eq('link_id', linkId)
                .order('checked_at', { ascending: true })

            if (checksError) {
                console.error('❌ Error getting wey checks:', checksError)
            }

            return this.processSimplifiedData(clicks || [], weyChecks || [])

        } catch (error) {
            console.error('❌ Error getting analytics:', error.message)
            return this.processSimplifiedData([], [])
        }
    }

    // Process analytics data (simplified)
    static processSimplifiedData(clicks, weyChecks) {
        try {
            const now = new Date()
            const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
            const last7Days = new Date(today.getTime() - 6 * 24 * 60 * 60 * 1000)
            const last30Days = new Date(today.getTime() - 29 * 24 * 60 * 60 * 1000)

            // Time-based statistics
            const clicksToday = clicks.filter(c => {
                try {
                    return new Date(c.clicked_at) >= today
                } catch {
                    return false
                }
            })
            
            const clicksLast7Days = clicks.filter(c => {
                try {
                    return new Date(c.clicked_at) >= last7Days
                } catch {
                    return false
                }
            })
            
            const clicksLast30Days = clicks.filter(c => {
                try {
                    return new Date(c.clicked_at) >= last30Days
                } catch {
                    return false
                }
            })

            // Location analysis (simplified)
            const locationBreakdown = {}
            clicks.forEach(click => {
                if (click.location && click.location !== 'Unknown Location') {
                    locationBreakdown[click.location] = (locationBreakdown[click.location] || 0) + 1
                }
            })

            // Device analysis from wey checks
            const deviceBreakdown = {}
            weyChecks.forEach(check => {
                try {
                    if (check.device_info) {
                        const deviceInfo = JSON.parse(check.device_info)
                        const deviceKey = deviceInfo.brand !== 'Unknown' 
                            ? `${deviceInfo.brand} ${deviceInfo.device}`
                            : deviceInfo.device
                        
                        deviceBreakdown[deviceKey] = (deviceBreakdown[deviceKey] || 0) + 1
                    }
                } catch (error) {
                    console.error('❌ Error parsing device info:', error)
                }
            })

            // Peak activity analysis
            const hourlyBreakdown = {}
            clicks.forEach(click => {
                try {
                    const hour = new Date(click.clicked_at).getHours()
                    hourlyBreakdown[hour] = (hourlyBreakdown[hour] || 0) + 1
                } catch (error) {
                    // Skip invalid dates
                }
            })

            const peakHour = Object.entries(hourlyBreakdown)
                .sort(([,a], [,b]) => b - a)[0]

            return {
                totalClicks: clicks.length,
                uniqueClicks: clicks.filter(c => c.is_unique).length,
                totalWeyChecks: weyChecks.length,
                clicksToday: clicksToday.length,
                clicksLast7Days: clicksLast7Days.length,
                clicksLast30Days: clicksLast30Days.length,
                topLocations: Object.entries(locationBreakdown)
                    .sort(([,a], [,b]) => b - a)
                    .slice(0, 5),
                topDevices: Object.entries(deviceBreakdown)
                    .sort(([,a], [,b]) => b - a)
                    .slice(0, 3),
                peakHour: peakHour ? {
                    hour: parseInt(peakHour[0]),
                    clicks: peakHour[1]
                } : null,
                firstClick: clicks.length > 0 ? clicks[0].clicked_at : null,
                lastClick: clicks.length > 0 ? clicks[clicks.length - 1].clicked_at : null
            }
        } catch (error) {
            console.error('❌ Error processing simplified data:', error)
            return {
                totalClicks: 0,
                uniqueClicks: 0,
                totalWeyChecks: 0,
                clicksToday: 0,
                clicksLast7Days: 0,
                clicksLast30Days: 0,
                topLocations: [],
                topDevices: [],
                peakHour: null,
                firstClick: null,
                lastClick: null
            }
        }
    }

    // Compile simplified report
    static compileSimplifiedReport(link, analytics) {
        try {
            let message = `📊 *Analytics Report*\n\n`
            message += `🔗 *Link:* ${link.short_code}\n`
            message += `📱 *Target:* +${link.target_phone}\n`
            
            try {
                const linkAge = Math.floor((new Date() - new Date(link.created_at)) / (1000 * 60 * 60 * 24))
                message += `📅 *Age:* ${linkAge} days\n`
                message += `⏰ *Expires:* ${new Date(link.expires_at).toLocaleDateString()}\n\n`
            } catch {
                message += `📅 *Created:* ${link.created_at}\n\n`
            }

            // Performance Summary
            message += `📈 *Performance Summary*\n`
            message += `• Total Clicks: ${analytics.totalClicks || 0}\n`
            message += `• Unique Visitors: ${analytics.uniqueClicks || 0}\n`
            message += `• Verifications: ${analytics.totalWeyChecks || 0}\n`
            message += `• Today: ${analytics.clicksToday || 0} clicks\n`
            message += `• Last 7 days: ${analytics.clicksLast7Days || 0} clicks\n`
            message += `• Last 30 days: ${analytics.clicksLast30Days || 0} clicks\n\n`

            // Click Rate
            const clickRate = analytics.totalClicks > 0 ? 
                (analytics.uniqueClicks / analytics.totalClicks * 100).toFixed(1) : 0
            const verificationRate = analytics.totalClicks > 0 && analytics.totalWeyChecks > 0 ? 
                (analytics.totalWeyChecks / analytics.totalClicks * 100).toFixed(1) : 0

            message += `📊 *Insights*\n`
            message += `• Unique Rate: ${clickRate}%\n`
            message += `• Verification Rate: ${verificationRate}%\n`
            message += `• Daily Average: ${analytics.clicksLast7Days > 0 ? (analytics.clicksLast7Days / 7).toFixed(1) : 0} clicks\n`

            // Peak Hour
            if (analytics.peakHour) {
                const hour = analytics.peakHour.hour
                const timeStr = hour === 0 ? '12 AM' : 
                              hour < 12 ? `${hour} AM` : 
                              hour === 12 ? '12 PM' : 
                              `${hour - 12} PM`
                message += `• Peak Hour: ${timeStr} (${analytics.peakHour.clicks} clicks)\n`
            }

            // Top Locations
            if (analytics.topLocations.length > 0) {
                message += `\n📍 *Top Locations*\n`
                analytics.topLocations.forEach(([location, count], index) => {
                    message += `${index + 1}. ${location}: ${count} clicks\n`
                })
            }

            // Top Devices (from verifications)
            if (analytics.topDevices.length > 0) {
                message += `\n📱 *Verified Devices*\n`
                analytics.topDevices.forEach(([device, count], index) => {
                    message += `${index + 1}. ${device}: ${count} verifications\n`
                })
            }

            // Timeline
            if (analytics.firstClick && analytics.lastClick) {
                try {
                    message += `\n⏱️ *Timeline*\n`
                    message += `• First Click: ${new Date(analytics.firstClick).toLocaleDateString()}\n`
                    message += `• Last Click: ${new Date(analytics.lastClick).toLocaleDateString()}\n`
                } catch {
                    // Skip timeline if dates are invalid
                }
            }

            message += `\n_Report generated by d-wey analytics_`
            return message

        } catch (error) {
            console.error('❌ Error compiling report:', error)
            return '❌ Error generating report. Please contact support.'
        }
    }

    // Get quick stats for link (free)
    static async getQuickStats(shortCode, phoneNumber) {
        try {
            console.log(`📊 Getting quick stats for ${shortCode} by ${phoneNumber}`)
            
            const { data: link, error } = await supabase
                .from('whatsapp_links')
                .select(`
                    short_code,
                    total_clicks,
                    unique_clicks,
                    wey_checks,
                    created_at,
                    expires_at,
                    is_active,
                    last_clicked_at
                `)
                .eq('short_code', shortCode)
                .eq('creator_phone', phoneNumber)
                .maybeSingle()

            if (error) {
                throw new Error(`Database error: ${error.message}`)
            }

            if (!link) {
                throw new Error('Link not found or you are not the owner')
            }

            const daysLeft = Math.ceil((new Date(link.expires_at) - new Date()) / (1000 * 60 * 60 * 24))
            const linkAge = Math.floor((new Date() - new Date(link.created_at)) / (1000 * 60 * 60 * 24))

            return {
                shortCode: link.short_code,
                totalClicks: link.total_clicks || 0,
                uniqueClicks: link.unique_clicks || 0,
                weyChecks: link.wey_checks || 0,
                daysLeft: Math.max(0, daysLeft),
                linkAge: linkAge,
                isActive: link.is_active,
                lastClicked: link.last_clicked_at ? 
                    new Date(link.last_clicked_at).toLocaleDateString() : 'Never'
            }

        } catch (error) {
            console.error('❌ Error getting quick stats:', error.message)
            throw error
        }
    }

    // Get public stats for third-party access
    static async getPublicStats(shortCode) {
        try {
            const { data: link, error } = await supabase
                .from('whatsapp_links')
                .select(`
                    short_code,
                    total_clicks,
                    unique_clicks,
                    wey_checks,
                    created_at,
                    is_active
                `)
                .eq('short_code', shortCode)
                .eq('is_active', true)
                .single()

            if (error || !link) {
                throw new Error('Link not found')
            }

            const linkAge = Math.floor((new Date() - new Date(link.created_at)) / (1000 * 60 * 60 * 24))

            return {
                shortCode: link.short_code,
                totalClicks: link.total_clicks || 0,
                uniqueClicks: link.unique_clicks || 0,
                weyChecks: link.wey_checks || 0,
                linkAge: linkAge,
                isActive: link.is_active
            }

        } catch (error) {
            throw error
        }
    }

    // Format report for WhatsApp message
    static formatReportForWhatsApp(report) {
        try {
            return this.compileSimplifiedReport(report.linkInfo, report.stats)
        } catch (error) {
            console.error('❌ Error formatting report:', error)
            return '❌ Error generating report. Please try again.'
        }
    }
}

module.exports = AnalyticsService