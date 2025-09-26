const { supabase } = require('../config/database')
const https = require('https')
const UserService = require('./userService')

class AnalyticsService {
    static QUICKCHART_BASE_URL = 'https://quickchart.io/chart'

    // Generate comprehensive analytics report
    static async generateAnalyticsReport(phoneNumber, shortCode) {
        try {
            console.log(`📊 Generating analytics for ${shortCode} by ${phoneNumber}`)
            
            // Check if user has sufficient balance
            const user = await UserService.getUserByPhone(phoneNumber)
            if (!user || user.wallet_balance < 20) { // TUMS_PRICING.ANALYTICS_REPORT
                throw new Error(`Insufficient balance. Need 20 tums for analytics report`)
            }

            // Get link data - FIXED QUERY
            const { data: link, error: linkError } = await supabase
                .from('whatsapp_links')
                .select('*')
                .eq('short_code', shortCode)
                .eq('creator_phone', phoneNumber)
                .eq('is_active', true)
                .maybeSingle()

            if (linkError) {
                console.error('❌ Error getting link for analytics:', linkError)
                throw new Error(`Database error: ${linkError.message}`)
            }

            if (!link) {
                throw new Error('Link not found or you are not the owner')
            }

            console.log(`✅ Link found for analytics: ${link.id}`)

            // Get detailed analytics data
            const analytics = await this.getDetailedAnalytics(link.id)
            
            // Generate charts
            const charts = await this.generateCharts(analytics)
            
            // Deduct cost from user balance
            await UserService.deductFromWallet(
                phoneNumber,
                20, // ANALYTICS_REPORT cost
                `Analytics report - ${shortCode}`
            )

            // Compile report
            const report = this.compileReport(link, analytics, charts)
            
            console.log(`📊 Analytics report generated for ${shortCode}`)
            return report

        } catch (error) {
            console.error('❌ Error generating analytics report:', error.message)
            throw error
        }
    }

    // Get detailed analytics data - FIXED QUERIES
    static async getDetailedAnalytics(linkId) {
        try {
            console.log(`📈 Getting detailed analytics for link: ${linkId}`)
            
            // Get all clicks - FIXED QUERY
            const { data: clicks, error: clicksError } = await supabase
                .from('link_clicks')
                .select('*')
                .eq('link_id', linkId)
                .order('clicked_at', { ascending: true })

            if (clicksError) {
                console.error('❌ Error getting clicks:', clicksError)
                // Don't throw, continue with empty array
            }

            // Get all wey checks - FIXED QUERY
            const { data: weyChecks, error: checksError } = await supabase
                .from('wey_checks')
                .select('*')
                .eq('link_id', linkId)
                .order('checked_at', { ascending: true })

            if (checksError) {
                console.error('❌ Error getting wey checks:', checksError)
                // Don't throw, continue with empty array
            }

            console.log(`📊 Analytics data: ${clicks?.length || 0} clicks, ${weyChecks?.length || 0} wey checks`)

            return this.processAnalyticsData(clicks || [], weyChecks || [])

        } catch (error) {
            console.error('❌ Error getting detailed analytics:', error.message)
            // Return empty data instead of throwing
            return this.processAnalyticsData([], [])
        }
    }

    // Process raw analytics data - ENHANCED ERROR HANDLING
    static processAnalyticsData(clicks, weyChecks) {
        try {
            const now = new Date()
            const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
            const last7Days = new Date(today.getTime() - 6 * 24 * 60 * 60 * 1000)
            const last30Days = new Date(today.getTime() - 29 * 24 * 60 * 60 * 1000)

            // Daily breakdown for last 7 days
            const dailyBreakdown = {}
            for (let i = 0; i < 7; i++) {
                const date = new Date(today.getTime() - i * 24 * 60 * 60 * 1000)
                const dateStr = date.toISOString().split('T')[0]
                dailyBreakdown[dateStr] = { clicks: 0, unique: 0, weyChecks: 0 }
            }

            // Process clicks safely
            clicks.forEach(click => {
                try {
                    const clickDate = new Date(click.clicked_at)
                    const dateStr = clickDate.toISOString().split('T')[0]
                    
                    if (dailyBreakdown[dateStr]) {
                        dailyBreakdown[dateStr].clicks++
                        if (click.is_unique) dailyBreakdown[dateStr].unique++
                    }
                } catch (error) {
                    console.error('❌ Error processing click:', error)
                }
            })

            // Process wey checks safely
            weyChecks.forEach(check => {
                try {
                    const checkDate = new Date(check.checked_at)
                    const dateStr = checkDate.toISOString().split('T')[0]
                    
                    if (dailyBreakdown[dateStr]) {
                        dailyBreakdown[dateStr].weyChecks++
                    }
                } catch (error) {
                    console.error('❌ Error processing wey check:', error)
                }
            })

            // Device breakdown
            const deviceBreakdown = {}
            const browserBreakdown = {}
            const locationBreakdown = {}

            clicks.forEach(click => {
                try {
                    // Device stats
                    if (click.device_type) {
                        deviceBreakdown[click.device_type] = (deviceBreakdown[click.device_type] || 0) + 1
                    }
                    
                    // Browser stats  
                    if (click.browser) {
                        browserBreakdown[click.browser] = (browserBreakdown[click.browser] || 0) + 1
                    }
                    
                    // Location stats (if available)
                    if (click.location) {
                        locationBreakdown[click.location] = (locationBreakdown[click.location] || 0) + 1
                    }
                } catch (error) {
                    console.error('❌ Error processing click breakdown:', error)
                }
            })

            // Time-based filters
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
            
            const clicksToday = clicks.filter(c => {
                try {
                    return new Date(c.clicked_at) >= today
                } catch {
                    return false
                }
            })

            return {
                totalClicks: clicks.length,
                uniqueClicks: clicks.filter(c => c.is_unique).length,
                totalWeyChecks: weyChecks.length,
                clicksToday: clicksToday.length,
                clicksLast7Days: clicksLast7Days.length,
                clicksLast30Days: clicksLast30Days.length,
                dailyBreakdown,
                deviceBreakdown,
                browserBreakdown,
                locationBreakdown,
                firstClick: clicks.length > 0 ? clicks[0].clicked_at : null,
                lastClick: clicks.length > 0 ? clicks[clicks.length - 1].clicked_at : null
            }
        } catch (error) {
            console.error('❌ Error processing analytics data:', error)
            return {
                totalClicks: 0,
                uniqueClicks: 0,
                totalWeyChecks: 0,
                clicksToday: 0,
                clicksLast7Days: 0,
                clicksLast30Days: 0,
                dailyBreakdown: {},
                deviceBreakdown: {},
                browserBreakdown: {},
                locationBreakdown: {},
                firstClick: null,
                lastClick: null
            }
        }
    }

    // Generate charts using QuickChart - ENHANCED ERROR HANDLING
    static async generateCharts(analytics) {
        const charts = {}

        try {
            // Only generate charts if we have data
            if (analytics.totalClicks > 0) {
                // 1. Daily clicks chart (last 7 days)
                charts.dailyClicks = await this.generateDailyClicksChart(analytics.dailyBreakdown)
                
                // 2. Device breakdown pie chart
                if (Object.keys(analytics.deviceBreakdown).length > 0) {
                    charts.deviceBreakdown = await this.generateDeviceChart(analytics.deviceBreakdown)
                }
                
                // 3. Browser breakdown chart
                if (Object.keys(analytics.browserBreakdown).length > 0) {
                    charts.browserBreakdown = await this.generateBrowserChart(analytics.browserBreakdown)
                }
                
                // 4. Location breakdown (if data available)
                if (Object.keys(analytics.locationBreakdown).length > 0) {
                    charts.locationBreakdown = await this.generateLocationChart(analytics.locationBreakdown)
                }
            } else {
                console.log('📊 No clicks data, skipping chart generation')
            }

        } catch (error) {
            console.error('❌ Error generating charts:', error.message)
        }

        return charts
    }

    // Generate daily clicks chart - SAFE VERSION
    static async generateDailyClicksChart(dailyData) {
        try {
            const labels = Object.keys(dailyData).sort()
            const clicksData = labels.map(date => dailyData[date]?.clicks || 0)
            const uniqueData = labels.map(date => dailyData[date]?.unique || 0)
            const weyData = labels.map(date => dailyData[date]?.weyChecks || 0)

            const chartConfig = {
                type: 'line',
                data: {
                    labels: labels.map(date => {
                        try {
                            const d = new Date(date)
                            return d.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' })
                        } catch {
                            return date
                        }
                    }),
                    datasets: [
                        {
                            label: 'Total Clicks',
                            data: clicksData,
                            borderColor: '#25D366',
                            backgroundColor: 'rgba(37, 211, 102, 0.1)',
                            tension: 0.4
                        },
                        {
                            label: 'Unique Clicks',
                            data: uniqueData,
                            borderColor: '#128C7E',
                            backgroundColor: 'rgba(18, 140, 126, 0.1)',
                            tension: 0.4
                        },
                        {
                            label: 'Wey Checks',
                            data: weyData,
                            borderColor: '#075E54',
                            backgroundColor: 'rgba(7, 94, 84, 0.1)',
                            tension: 0.4
                        }
                    ]
                },
                options: {
                    responsive: true,
                    plugins: {
                        title: { display: true, text: 'Daily Activity (Last 7 Days)' },
                        legend: { position: 'top' }
                    },
                    scales: {
                        y: { beginAtZero: true }
                    }
                }
            }

            return this.getChartUrl(chartConfig)
        } catch (error) {
            console.error('❌ Error generating daily chart:', error)
            return null
        }
    }

    // Generate device breakdown chart - SAFE VERSION
    static async generateDeviceChart(deviceData) {
        try {
            if (Object.keys(deviceData).length === 0) return null

            const chartConfig = {
                type: 'doughnut',
                data: {
                    labels: Object.keys(deviceData).map(d => d.charAt(0).toUpperCase() + d.slice(1)),
                    datasets: [{
                        data: Object.values(deviceData),
                        backgroundColor: ['#25D366', '#128C7E', '#075E54', '#DCF8C6']
                    }]
                },
                options: {
                    responsive: true,
                    plugins: {
                        title: { display: true, text: 'Device Types' },
                        legend: { position: 'right' }
                    }
                }
            }

            return this.getChartUrl(chartConfig)
        } catch (error) {
            console.error('❌ Error generating device chart:', error)
            return null
        }
    }

    // Generate browser breakdown chart - SAFE VERSION
    static async generateBrowserChart(browserData) {
        try {
            if (Object.keys(browserData).length === 0) return null

            const chartConfig = {
                type: 'bar',
                data: {
                    labels: Object.keys(browserData).map(b => b.charAt(0).toUpperCase() + b.slice(1)),
                    datasets: [{
                        label: 'Clicks by Browser',
                        data: Object.values(browserData),
                        backgroundColor: '#25D366'
                    }]
                },
                options: {
                    responsive: true,
                    plugins: {
                        title: { display: true, text: 'Browser Usage' },
                        legend: { display: false }
                    },
                    scales: {
                        y: { beginAtZero: true }
                    }
                }
            }

            return this.getChartUrl(chartConfig)
        } catch (error) {
            console.error('❌ Error generating browser chart:', error)
            return null
        }
    }

    // Get chart URL from QuickChart
    static getChartUrl(chartConfig) {
        try {
            const encodedChart = encodeURIComponent(JSON.stringify(chartConfig))
            return `${this.QUICKCHART_BASE_URL}?c=${encodedChart}&width=500&height=300&format=png`
        } catch (error) {
            console.error('❌ Error creating chart URL:', error)
            return null
        }
    }

    // Compile comprehensive report - SAFE VERSION
    static compileReport(link, analytics, charts) {
        try {
            const report = {
                linkInfo: {
                    shortCode: link.short_code,
                    targetPhone: link.target_phone,
                    redirectUrl: link.redirect_url,
                    weyUrl: link.wey_url,
                    createdAt: link.created_at,
                    expiresAt: link.expires_at,
                    isCustomShortcode: link.is_custom_shortcode
                },
                stats: {
                    totalClicks: analytics.totalClicks || 0,
                    uniqueClicks: analytics.uniqueClicks || 0,
                    totalWeyChecks: analytics.totalWeyChecks || 0,
                    clicksToday: analytics.clicksToday || 0,
                    clicksLast7Days: analytics.clicksLast7Days || 0,
                    clicksLast30Days: analytics.clicksLast30Days || 0
                },
                breakdown: {
                    devices: analytics.deviceBreakdown || {},
                    browsers: analytics.browserBreakdown || {},
                    locations: analytics.locationBreakdown || {}
                },
                charts: charts || {},
                performance: {
                    clickRate: analytics.totalClicks > 0 ? (analytics.uniqueClicks / analytics.totalClicks * 100).toFixed(1) : 0,
                    averageDaily: analytics.clicksLast7Days > 0 ? (analytics.clicksLast7Days / 7).toFixed(1) : 0,
                    peakDay: this.findPeakDay(analytics.dailyBreakdown || {}),
                    conversionRate: analytics.totalClicks > 0 && analytics.totalWeyChecks > 0 ? 
                        (analytics.totalWeyChecks / analytics.totalClicks * 100).toFixed(1) : 0
                },
                timeline: {
                    firstClick: analytics.firstClick,
                    lastClick: analytics.lastClick,
                    daysActive: this.calculateDaysActive(link.created_at, analytics.lastClick)
                }
            }

            return report
        } catch (error) {
            console.error('❌ Error compiling report:', error)
            throw error
        }
    }

    // Find peak day from daily breakdown - SAFE
    static findPeakDay(dailyBreakdown) {
        try {
            let peakDay = null
            let maxClicks = 0

            Object.entries(dailyBreakdown).forEach(([date, data]) => {
                const clicks = data?.clicks || 0
                if (clicks > maxClicks) {
                    maxClicks = clicks
                    peakDay = date
                }
            })

            return { date: peakDay, clicks: maxClicks }
        } catch (error) {
            return { date: null, clicks: 0 }
        }
    }

    // Calculate days active - SAFE
    static calculateDaysActive(createdAt, lastClick) {
        try {
            if (!lastClick) return 0
            
            const created = new Date(createdAt)
            const last = new Date(lastClick)
            const diffTime = Math.abs(last - created)
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
            
            return diffDays
        } catch (error) {
            return 0
        }
    }

    // Generate third-party verification report - FIXED
    static async generateThirdPartyReport(shortCode, deviceInfo, hashedIp, location = null) {
        try {
            console.log(`🔍 Generating third-party report for: ${shortCode}`)
            
            // Get link basic info (no ownership verification needed)
            const { data: link, error: linkError } = await supabase
                .from('whatsapp_links')
                .select(`
                    short_code,
                    target_phone,
                    total_clicks,
                    unique_clicks,
                    wey_checks,
                    created_at,
                    is_active
                `)
                .eq('short_code', shortCode)
                .eq('is_active', true)
                .maybeSingle()

            if (linkError) {
                console.error('❌ Error getting link for third-party report:', linkError)
                throw new Error(`Database error: ${linkError.message}`)
            }

            if (!link) {
                throw new Error('Link not found or inactive')
            }

            // Create verification report
            const report = {
                verification: {
                    shortCode: link.short_code,
                    isValid: link.is_active,
                    verifiedAt: new Date().toISOString(),
                    verifierInfo: {
                        device: deviceInfo.device || 'unknown',
                        browser: deviceInfo.browser || 'unknown',
                        os: deviceInfo.os || 'unknown',
                        location: location || 'unknown',
                        hashedId: hashedIp ? hashedIp.substring(0, 8) + '...' : 'unknown'
                    }
                },
                linkStats: {
                    totalClicks: link.total_clicks || 0,
                    uniqueVisitors: link.unique_clicks || 0,
                    verifications: link.wey_checks || 0,
                    createdDaysAgo: Math.floor((new Date() - new Date(link.created_at)) / (1000 * 60 * 60 * 24))
                },
                authenticity: {
                    isGenuine: true,
                    platform: 'd-wey',
                    trustScore: this.calculateTrustScore(link)
                }
            }

            console.log(`✅ Third-party report generated for ${shortCode}`)
            return report

        } catch (error) {
            console.error('❌ Error generating third-party report:', error.message)
            throw error
        }
    }

    // Calculate trust score - SAFE
    static calculateTrustScore(link) {
        try {
            let score = 50 // Base score

            // Age factor (older links are more trustworthy)
            const ageInDays = Math.floor((new Date() - new Date(link.created_at)) / (1000 * 60 * 60 * 24))
            if (ageInDays > 7) score += 20
            else if (ageInDays > 3) score += 10

            // Activity factor
            const totalClicks = link.total_clicks || 0
            if (totalClicks > 100) score += 20
            else if (totalClicks > 50) score += 15
            else if (totalClicks > 10) score += 10

            // Verification factor
            const weyChecks = link.wey_checks || 0
            if (weyChecks > 5) score += 10
            else if (weyChecks > 0) score += 5

            return Math.min(100, score)
        } catch (error) {
            console.error('❌ Error calculating trust score:', error)
            return 50
        }
    }

    // Format report for WhatsApp message - SAFE
    static formatReportForWhatsApp(report, isOwnerReport = true) {
        try {
            if (isOwnerReport) {
                return this.formatOwnerReport(report)
            } else {
                return this.formatThirdPartyReport(report)
            }
        } catch (error) {
            console.error('❌ Error formatting report:', error)
            return '❌ Error generating report. Please try again.'
        }
    }

    // Format owner's detailed report - SAFE
    static formatOwnerReport(report) {
        try {
            const { linkInfo, stats, performance, timeline } = report

            let message = `📊 *Analytics Report*\n\n`
            message += `🔗 *Link:* ${linkInfo.shortCode}\n`
            message += `📱 *Target:* +${linkInfo.targetPhone}\n`
            
            try {
                message += `⏱️ *Created:* ${new Date(linkInfo.createdAt).toLocaleDateString()}\n`
                message += `⏰ *Expires:* ${new Date(linkInfo.expiresAt).toLocaleDateString()}\n\n`
            } catch {
                message += `⏱️ *Created:* ${linkInfo.createdAt}\n\n`
            }

            message += `📈 *Performance Summary*\n`
            message += `• Total Clicks: ${stats.totalClicks || 0}\n`
            message += `• Unique Visitors: ${stats.uniqueClicks || 0}\n`
            message += `• Today: ${stats.clicksToday || 0} clicks\n`
            message += `• Last 7 days: ${stats.clicksLast7Days || 0} clicks\n`
            message += `• Wey Checks: ${stats.totalWeyChecks || 0}\n\n`

            message += `📊 *Insights*\n`
            message += `• Click Rate: ${performance.clickRate || 0}%\n`
            message += `• Daily Average: ${performance.averageDaily || 0} clicks\n`
            message += `• Conversion: ${performance.conversionRate || 0}%\n`

            if (performance.peakDay && performance.peakDay.clicks > 0) {
                try {
                    message += `• Peak Day: ${new Date(performance.peakDay.date).toLocaleDateString()} (${performance.peakDay.clicks} clicks)\n`
                } catch {
                    message += `• Peak Day: ${performance.peakDay.clicks} clicks\n`
                }
            }

            if (timeline.daysActive > 0) {
                message += `• Active Days: ${timeline.daysActive}\n`
            }

            // Top devices - SAFE
            if (report.breakdown && report.breakdown.devices) {
                const topDevices = Object.entries(report.breakdown.devices)
                    .sort(([,a], [,b]) => b - a)
                    .slice(0, 3)

                if (topDevices.length > 0) {
                    message += `\n📱 *Top Devices*\n`
                    topDevices.forEach(([device, count]) => {
                        message += `• ${device.charAt(0).toUpperCase() + device.slice(1)}: ${count}\n`
                    })
                }
            }

            message += `\n_Report generated with d-wey analytics_`
            return message
        } catch (error) {
            console.error('❌ Error formatting owner report:', error)
            return '❌ Error formatting report. Please contact support.'
        }
    }

    // Get quick stats for link - FIXED
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
                    is_active
                `)
                .eq('short_code', shortCode)
                .eq('creator_phone', phoneNumber)
                .maybeSingle()

            if (error) {
                console.error('❌ Error getting quick stats:', error)
                throw new Error(`Database error: ${error.message}`)
            }

            if (!link) {
                throw new Error('Link not found or you are not the owner')
            }

            const daysLeft = Math.ceil((new Date(link.expires_at) - new Date()) / (1000 * 60 * 60 * 24))

            return {
                shortCode: link.short_code,
                totalClicks: link.total_clicks || 0,
                uniqueClicks: link.unique_clicks || 0,
                weyChecks: link.wey_checks || 0,
                daysLeft: Math.max(0, daysLeft),
                isActive: link.is_active
            }

        } catch (error) {
            console.error('❌ Error getting quick stats:', error.message)
            throw error
        }
    }
}

module.exports = AnalyticsService