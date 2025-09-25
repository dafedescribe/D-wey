const https = require('https')
const http = require('http')

class LocationService {
    // Free geolocation APIs (no API key required)
    static FREE_GEO_APIS = [
        'ip-api.com',
        'ipapi.co',
        'freegeoip.app'
    ]

    // Get location from IP address using multiple free services
    static async getLocationFromIP(ipAddress) {
        // Skip private/local IPs
        if (this.isPrivateIP(ipAddress)) {
            return { city: 'Local Network', country: 'Unknown', region: 'Private' }
        }

        // Try multiple services for reliability
        for (const service of this.FREE_GEO_APIS) {
            try {
                const location = await this.queryGeoService(service, ipAddress)
                if (location && location.city) {
                    console.log(`📍 Location found via ${service}: ${location.city}, ${location.country}`)
                    return location
                }
            } catch (error) {
                console.log(`⚠️ ${service} failed: ${error.message}`)
                continue
            }
        }

        // Fallback to unknown location
        return { city: 'Unknown', country: 'Unknown', region: 'Unknown' }
    }

    // Query specific geolocation service
    static async queryGeoService(service, ipAddress) {
        return new Promise((resolve, reject) => {
            let path, hostname, protocol

            switch (service) {
                case 'ip-api.com':
                    hostname = 'ip-api.com'
                    path = `/json/${ipAddress}?fields=status,country,regionName,city,isp`
                    protocol = http
                    break

                case 'ipapi.co':
                    hostname = 'ipapi.co'
                    path = `/${ipAddress}/json/`
                    protocol = https
                    break

                case 'freegeoip.app':
                    hostname = 'freegeoip.app'
                    path = `/json/${ipAddress}`
                    protocol = https
                    break

                default:
                    return reject(new Error('Unknown service'))
            }

            const options = {
                hostname,
                path,
                method: 'GET',
                headers: {
                    'User-Agent': 'd-wey/1.0'
                },
                timeout: 5000
            }

            const req = protocol.request(options, (res) => {
                let data = ''

                res.on('data', (chunk) => {
                    data += chunk
                })

                res.on('end', () => {
                    try {
                        const result = JSON.parse(data)
                        const location = this.parseLocationResponse(service, result)
                        resolve(location)
                    } catch (error) {
                        reject(new Error('Invalid JSON response'))
                    }
                })
            })

            req.on('error', (error) => {
                reject(error)
            })

            req.on('timeout', () => {
                req.destroy()
                reject(new Error('Request timeout'))
            })

            req.end()
        })
    }

    // Parse location response from different services
    static parseLocationResponse(service, data) {
        try {
            switch (service) {
                case 'ip-api.com':
                    if (data.status === 'success') {
                        return {
                            city: data.city || 'Unknown',
                            region: data.regionName || 'Unknown',
                            country: data.country || 'Unknown',
                            isp: data.isp || 'Unknown'
                        }
                    }
                    break

                case 'ipapi.co':
                    if (data.city) {
                        return {
                            city: data.city || 'Unknown',
                            region: data.region || 'Unknown',
                            country: data.country_name || data.country || 'Unknown',
                            isp: data.org || 'Unknown'
                        }
                    }
                    break

                case 'freegeoip.app':
                    if (data.city) {
                        return {
                            city: data.city || 'Unknown',
                            region: data.region_name || 'Unknown',
                            country: data.country_name || 'Unknown',
                            isp: 'Unknown'
                        }
                    }
                    break
            }

            return null
        } catch (error) {
            return null
        }
    }

    // Check if IP is private/local
    static isPrivateIP(ip) {
        const privateRanges = [
            /^10\./,
            /^172\.(1[6-9]|2\d|3[01])\./,
            /^192\.168\./,
            /^127\./,
            /^169\.254\./,
            /^::1$/,
            /^fc00:/,
            /^fe80:/
        ]

        return privateRanges.some(range => range.test(ip))
    }

    // Format location for display
    static formatLocation(location) {
        if (!location || location.city === 'Unknown') {
            return 'Unknown Location'
        }

        let formatted = location.city

        if (location.region && location.region !== 'Unknown' && location.region !== location.city) {
            formatted += `, ${location.region}`
        }

        if (location.country && location.country !== 'Unknown') {
            formatted += `, ${location.country}`
        }

        return formatted
    }

    // Get location with caching to avoid repeated API calls
    static locationCache = new Map()
    static CACHE_DURATION = 60 * 60 * 1000 // 1 hour

    static async getCachedLocation(ipAddress) {
        try {
            // Check cache first
            const cacheKey = ipAddress
            const cached = this.locationCache.get(cacheKey)

            if (cached && (Date.now() - cached.timestamp) < this.CACHE_DURATION) {
                return cached.location
            }

            // Get fresh location data
            const location = await this.getLocationFromIP(ipAddress)

            // Cache the result
            this.locationCache.set(cacheKey, {
                location,
                timestamp: Date.now()
            })

            return location
        } catch (error) {
            console.error('❌ Error getting cached location:', error.message)
            return { city: 'Unknown', country: 'Unknown', region: 'Unknown' }
        }
    }

    // Clean up old cache entries
    static cleanupCache() {
        const now = Date.now()
        for (const [key, value] of this.locationCache.entries()) {
            if ((now - value.timestamp) > this.CACHE_DURATION) {
                this.locationCache.delete(key)
            }
        }
    }

    // Get timezone from location (basic estimation)
    static getTimezoneFromLocation(location) {
        if (!location || !location.country) return 'UTC'

        // Basic timezone mapping for major countries
        const timezoneMap = {
            'Nigeria': 'Africa/Lagos',
            'United States': 'America/New_York',
            'United Kingdom': 'Europe/London',
            'Germany': 'Europe/Berlin',
            'France': 'Europe/Paris',
            'India': 'Asia/Kolkata',
            'China': 'Asia/Shanghai',
            'Japan': 'Asia/Tokyo',
            'Australia': 'Australia/Sydney',
            'Brazil': 'America/Sao_Paulo',
            'Canada': 'America/Toronto',
            'South Africa': 'Africa/Johannesburg',
            'Egypt': 'Africa/Cairo',
            'Kenya': 'Africa/Nairobi',
            'Ghana': 'Africa/Accra'
        }

        return timezoneMap[location.country] || 'UTC'
    }

    // Validate IP address format
    static isValidIP(ip) {
        const ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/
        const ipv6Regex = /^(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/
        
        return ipv4Regex.test(ip) || ipv6Regex.test(ip)
    }

    // Get approximate distance between two locations (basic calculation)
    static calculateDistance(loc1, loc2) {
        // This is a very basic implementation
        // In production, you might want to use more sophisticated geolocation
        if (!loc1.country || !loc2.country) return null

        if (loc1.country === loc2.country) {
            if (loc1.city === loc2.city) return 0
            return 'same_country'
        }

        return 'different_country'
    }

    // Get location summary for analytics
    static getLocationSummary(locations) {
        const summary = {
            totalLocations: locations.length,
            countries: {},
            cities: {},
            regions: {}
        }

        locations.forEach(location => {
            if (location.country && location.country !== 'Unknown') {
                summary.countries[location.country] = (summary.countries[location.country] || 0) + 1
            }

            if (location.city && location.city !== 'Unknown') {
                summary.cities[location.city] = (summary.cities[location.city] || 0) + 1
            }

            if (location.region && location.region !== 'Unknown') {
                summary.regions[location.region] = (summary.regions[location.region] || 0) + 1
            }
        })

        // Get top entries
        summary.topCountries = Object.entries(summary.countries)
            .sort(([,a], [,b]) => b - a)
            .slice(0, 5)

        summary.topCities = Object.entries(summary.cities)
            .sort(([,a], [,b]) => b - a)
            .slice(0, 10)

        return summary
    }
}

// Clean up cache every hour
setInterval(() => {
    LocationService.cleanupCache()
}, 60 * 60 * 1000)

module.exports = LocationService