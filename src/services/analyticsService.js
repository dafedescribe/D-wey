const { supabase } = require('../config/database')
const https = require('https')
const UserService = require('./userService')
const LinkService = require('./linkService')

class AnalyticsService {
    static QUICKCHART_BASE_URL = 'https://quickchart.io/chart'

    // Generate comprehensive analytics report
    static async generateAnalyticsReport(phoneNumber, shortCode) {
        try {
            // Check if user has sufficient balance
            const user = await UserService.getUserByPhone(phoneNumber)
            if (!user || user.wallet_balance < LinkService.TUMS_PRICING.ANALYTICS_REPORT) {
                throw new Error(`Insufficient balance. Need ${LinkService.TUMS_PRICING.ANALYTICS_REPORT} tums for analytics report`)
            }

            // Get link data
            const { data: link, error: linkError } = await supabase
                .from('whatsapp_links')
                .select('*')
                .eq('short_code', shortCode)
                .eq('creator_phone', phoneNumber)
                .single()

            if (linkError || !link) {
                throw new Error('Link not found or you are not the owner')
            }

            // Get detailed analytics data
            const analytics = await this.getDetailedAnalytics(link.id)
            
            // Generate charts
            const charts = await this.generateCharts(analytics)
            
            // Deduct cost from user balance
            await UserService.deductFromWallet(
                phoneNumber,
                LinkService.TUMS_PRICING.ANALYTICS_REPORT,
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

    // Get detailed analytics data
    static async getDetailedAnalytics(linkId) {
        try {
            // Get all clicks
            const { data: clicks, error: clicksError } = await supabase
                .from('link_clicks')
                .select('*')
                .eq('link_id', linkId)
                .order('clicked_at', { ascending: true })

            if (clicksError) throw clicksError

            // Get all wey checks
            const { data: weyChecks, error: checksError } = await supabase
                .from('wey_checks')
                .select('*')
                .eq('link_id', linkId)
                .order('checked_at', { ascending: true })

            if (checksError) throw checksError

            return this.processAnalyticsData(clicks || [], weyChecks || [])

        } catch (error) {
            console.error('❌ Error getting detailed analytics:', error.message)
            throw error
        }
    }

    // Process raw analytics data
    static processAnalyticsData(clicks, weyChecks) {
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

        // Process clicks
        clicks.forEach(click => {
            const clickDate = new Date(click.clicked_at)
            const dateStr = clickDate.toISOString().split('T')[0]
            
            if (dailyBreakdown[dateStr]) {
                dailyBreakdown[dateStr].clicks++
                if (click.is_unique) dailyBreakdown[dateStr].unique++
            }
        })

        // Process wey checks
        weyChecks.forEach(check => {
            const checkDate = new Date(check.checked_at)
            const dateStr = checkDate.toISOString().split('T')[0]
            
            if (dailyBreakdown[dateStr]) {
                dailyBreakdown[dateStr].weyChecks++
            }
        })

        // Device breakdown
        const deviceBreakdown = {}
        const browserBreakdown = {}
        const locationBreakdown = {}

        clicks.forEach(click => {
            // Device stats
            deviceBreakdown[click.device_type] = (deviceBreakdown[click.device_type] || 0) + 1
            
            // Browser stats  
            browserBreakdown[click.browser] = (browserBreakdown[click.browser] || 0) + 1
            
            // Location stats (if available)
            if (click.location) {
                locationBreakdown[click.location] = (locationBreakdown[click.location] || 0) + 1
            }
        })

        // Time-based filters
        const clicksLast7Days = clicks.filter(c => new Date(c.clicked_at) >= last7Days)
        const clicksLast30Days = clicks.filter(c => new Date(c.clicked_at) >= last30Days)
        const clicksToday = clicks.filter(c => new Date(c.clicked_at) >= today)

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
    }

    // Generate charts using QuickChart
    static async generateCharts(analytics) {
        const charts = {}

        try {
            // 1. Daily clicks chart (last 7 days)
            charts.dailyClicks = await this.generateDailyClicksChart(analytics.dailyBreakdown)
            
            // 2. Device breakdown pie chart
            charts.deviceBreakdown = await this.generateDeviceChart(analytics.deviceBreakdown)
            
            // 3. Browser breakdown chart
            charts.browserBreakdown = await this.generateBrowserChart(analytics.browserBreakdown)
            
            // 4. Location breakdown (if data available)
            if (Object.keys(analytics.locationBreakdown).length > 0) {
                charts.locationBreakdown = await this.generateLocationChart(analytics.locationBreakdown)
            }

        } catch (error) {
            console.error('❌ Error generating charts:', error.message)
        }

        return charts
    }

    // Generate daily clicks chart
    static async generateDailyClicksChart(dailyData) {
        const labels = Object.keys(dailyData).sort()
        const clicksData = labels.map(date => dailyData[date].clicks)
        const uniqueData = labels.map(date => dailyData[date].unique)
        const weyData = labels.map(date => dailyData[date].weyChecks)

        const chartConfig = {
            type: 'line',
            data: {
                labels: labels.map(date => {
                    const d = new Date(date)
                    return d.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' })
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
    }

    // Generate device breakdown chart
    static async generateDeviceChart(deviceData) {
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
    }

    // Generate browser breakdown chart
    static async generateBrowserChart(browserData) {
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
    }

    // Generate location breakdown chart
    static async generateLocationChart(locationData) {
        const topLocations = Object.entries(locationData)
            .sort(([,a], [,b]) => b - a)
            .slice(0, 10)

        const chartConfig = {
            type: 'horizontalBar',
            data: {
                labels: topLocations.map(([location]) => location),
                datasets: [{
                    label: 'Clicks by Location',
                    data: topLocations.map(([, clicks]) => clicks),
                    backgroundColor: '#128C7E'
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    title: { display: true, text: 'Top Locations' },
                    legend: { display: false }
                },
                scales: {
                    x: { beginAtZero: true }
                }
            }
        }

        return this.getChartUrl(chartConfig)
    }

    // Get chart URL from QuickChart
    static getChartUrl(chartConfig) {
        const encodedChart = encodeURIComponent(JSON.stringify(chartConfig))
        return `${this.QUICKCHART_BASE_URL}?c=${encodedChart}&width=500&height=300&format=png`
    }

    // Compile comprehensive report
    static compileReport(link, analytics, charts) {
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
                totalClicks: analytics.totalClicks,
                uniqueClicks: analytics.uniqueClicks,
                totalWeyChecks: analytics.totalWeyChecks,
                clicksToday: analytics.clicksToday,
                clicksLast7Days: analytics.clicksLast7Days,
                clicksLast30Days: analytics.clicksLast30Days
            },
            breakdown: {
                devices: analytics.deviceBreakdown,
                browsers: analytics.browserBreakdown,
                locations: analytics.locationBreakdown
            },
            charts: charts,
            performance: {
                clickRate: analytics.totalClicks > 0 ? (analytics.uniqueClicks / analytics.totalClicks * 100).toFixed(1) : 0,
                averageDaily: analytics.clicksLast7Days > 0 ? (analytics.clicksLast7Days / 7).toFixed(1) : 0,
                peakDay: this.findPeakDay(analytics.dailyBreakdown),
                conversionRate: analytics.totalWeyChecks > 0 ? (analytics.totalWeyChecks / analytics.totalClicks * 100).toFixed(1) : 0
            },
            timeline: {
                firstClick: analytics.firstClick,
                lastClick: analytics.lastClick,
                daysActive: this.calculateDaysActive(link.created_at, analytics.lastClick)
            }
        }

        return report
    }

    // Find peak day from daily breakdown
    static findPeakDay(dailyBreakdown) {
        let peakDay = null
        let maxClicks = 0

        Object.entries(dailyBreakdown).forEach(([date, data]) => {
            if (data.clicks > maxClicks) {
                maxClicks = data.clicks
                peakDay = date
            }
        })

        return { date: peakDay, clicks: maxClicks }
    }

    // Calculate days active
    static calculateDaysActive(createdAt, lastClick) {
        if (!lastClick) return 0
        
        const created = new Date(createdAt)
        const last = new Date(lastClick)
        const diffTime = Math.abs(last - created)
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
        
        return diffDays
    }

    // Generate third-party verification report
    static async generateThirdPartyReport(shortCode, deviceInfo, hashedIp, location = null) {
        try {
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
                .single()

            if (linkError || !link) {
                throw new Error('Link not found or inactive')
            }

            // Create verification report
            const report = {
                verification: {
                    shortCode: link.short_code,
                    isValid: link.is_active,
                    verifiedAt: new Date().toISOString(),
                    verifierInfo: {
                        device: deviceInfo.device,
                        browser: deviceInfo.browser,
                        os: deviceInfo.os,
                        location: location,
                        hashedId: hashedIp.substring(0, 8) + '...' // Partial hash for verification
                    }
                },
                linkStats: {
                    totalClicks: link.total_clicks,
                    uniqueVisitors: link.unique_clicks,
                    verifications: link.wey_checks,
                    createdDaysAgo: Math.floor((new Date() - new Date(link.created_at)) / (1000 * 60 * 60 * 24))
                },
                authenticity: {
                    isGenuine: true,
                    platform: 'd-wey',
                    trustScore: this.calculateTrustScore(link)
                }
            }

            console.log(`🔍 Third-party report generated for ${shortCode}`)
            return report

        } catch (error) {
            console.error('❌ Error generating third-party report:', error.message)
            throw error
        }
    }

    // Calculate trust score based on link activity
    static calculateTrustScore(link) {
        let score = 50 // Base score

        // Age factor (older links are more trustworthy)
        const ageInDays = Math.floor((new Date() - new Date(link.created_at)) / (1000 * 60 * 60 * 24))
        if (ageInDays > 7) score += 20
        else if (ageInDays > 3) score += 10

        // Activity factor
        if (link.total_clicks > 100) score += 20
        else if (link.total_clicks > 50) score += 15
        else if (link.total_clicks > 10) score += 10

        // Verification factor
        if (link.wey_checks > 5) score += 10
        else if (link.wey_checks > 0) score += 5

        return Math.min(100, score)
    }

    // Format report for WhatsApp message
    static formatReportForWhatsApp(report, isOwnerReport = true) {
        if (isOwnerReport) {
            return this.formatOwnerReport(report)
        } else {
            return this.formatThirdPartyReport(report)
        }
    }

    // Format owner's detailed report
    static formatOwnerReport(report) {
        const { linkInfo, stats, performance, timeline } = report

        let message = `📊 *Analytics Report*\n\n`
        message += `🔗 *Link:* ${linkInfo.shortCode}\n`
        message += `📱 *Target:* +${linkInfo.targetPhone}\n`
        message += `⏱️ *Created:* ${new Date(linkInfo.createdAt).toLocaleDateString()}\n`
        message += `⏰ *Expires:* ${new Date(linkInfo.expiresAt).toLocaleDateString()}\n\n`

        message += `📈 *Performance Summary*\n`
        message += `• Total Clicks: ${stats.totalClicks}\n`
        message += `• Unique Visitors: ${stats.uniqueClicks}\n`
        message += `• Today: ${stats.clicksToday} clicks\n`
        message += `• Last 7 days: ${stats.clicksLast7Days} clicks\n`
        message += `• Wey Checks: ${stats.totalWeyChecks}\n\n`

        message += `📊 *Insights*\n`
        message += `• Click Rate: ${performance.clickRate}%\n`
        message += `• Daily Average: ${performance.averageDaily} clicks\n`
        message += `• Conversion: ${performance.conversionRate}%\n`

        if (performance.peakDay.clicks > 0) {
            message += `• Peak Day: ${new Date(performance.peakDay.date).toLocaleDateString()} (${performance.peakDay.clicks} clicks)\n`
        }

        if (timeline.daysActive > 0) {
            message += `• Active Days: ${timeline.daysActive}\n`
        }

        // Top devices
        const topDevices = Object.entries(report.breakdown.devices)
            .sort(([,a], [,b]) => b - a)
            .slice(0, 3)

        if (topDevices.length > 0) {
            message += `\n📱 *Top Devices*\n`
            topDevices.forEach(([device, count]) => {
                message += `• ${device.charAt(0).toUpperCase() + device.slice(1)}: ${count}\n`
            })
        }

        // Chart links (if available)
        if (report.charts && Object.keys(report.charts).length > 0) {
            message += `\n📈 *Charts Available*\n`
            Object.entries(report.charts).forEach(([type, url]) => {
                if (url) {
                    message += `• ${type}: ${url}\n`
                }
            })
        }

        message += `\n_Report generated with d-wey analytics_`
        return message
    }

    // Format third-party verification report
    static formatThirdPartyReport(report) {
        const { verification, linkStats, authenticity } = report

        let message = `🔍 *Link Verification Report*\n\n`
        message += `✅ *Status:* ${verification.isValid ? 'VERIFIED' : 'INVALID'}\n`
        message += `🔗 *Code:* ${verification.shortCode}\n`
        message += `⏰ *Verified:* ${new Date(verification.verifiedAt).toLocaleString()}\n\n`

        message += `📊 *Public Stats*\n`
        message += `• Total Clicks: ${linkStats.totalClicks}\n`
        message += `• Unique Visitors: ${linkStats.uniqueVisitors}\n`
        message += `• Verifications: ${linkStats.verifications}\n`
        message += `• Age: ${linkStats.createdDaysAgo} days old\n\n`

        message += `🛡️ *Trust Score: ${authenticity.trustScore}/100*\n`
        
        if (authenticity.trustScore >= 80) {
            message += `✅ *Highly Trusted*\n`
        } else if (authenticity.trustScore >= 60) {
            message += `⚠️ *Moderately Trusted*\n`
        } else {
            message += `❌ *Low Trust - Use Caution*\n`
        }

        message += `\n👤 *Your Verification Details*\n`
        message += `• Device: ${verification.verifierInfo.device}\n`
        message += `• Browser: ${verification.verifierInfo.browser}\n`
        message += `• System: ${verification.verifierInfo.os}\n`
        
        if (verification.verifierInfo.location) {
            message += `• Location: ${verification.verifierInfo.location}\n`
        }
        
        message += `• ID: ${verification.verifierInfo.hashedId}\n`

        message += `\n_Verified by d-wey platform_`
        return message
    }

    // Get quick stats for link (lightweight version)
    static async getQuickStats(shortCode, phoneNumber) {
        try {
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
                .single()

            if (error || !link) {
                throw new Error('Link not found or you are not the owner')
            }

            const daysLeft = Math.ceil((new Date(link.expires_at) - new Date()) / (1000 * 60 * 60 * 24))

            return {
                shortCode: link.short_code,
                totalClicks: link.total_clicks,
                uniqueClicks: link.unique_clicks,
                weyChecks: link.wey_checks,
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