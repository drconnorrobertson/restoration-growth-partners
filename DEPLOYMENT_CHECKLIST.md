# Deployment Checklist - Restoration Growth Partners

## Pre-Deployment (Customize)

- [ ] Update footer company name, address, phone, email
- [ ] Update contact form to use actual email service (Formspree, Mailgun, etc.)
- [ ] Add your actual phone number in header CTA button
- [ ] Update social media links (LinkedIn, Facebook URLs)
- [ ] Replace placeholder company info with real information
- [ ] Review all content for accuracy and brand voice
- [ ] Add actual project images/logos when available
- [ ] Set up email forwarding for contact form submissions

## Deploy to Vercel

1. [ ] Push repository to GitHub
   ```bash
   git remote add origin https://github.com/yourusername/restoration-growth-partners.git
   git branch -M main
   git push -u origin main
   ```

2. [ ] Create Vercel account (vercel.com)

3. [ ] Import repository in Vercel
   - Click "New Project"
   - Select your GitHub repository
   - Accept default settings (Vercel auto-detects static site)
   - Click "Deploy"

4. [ ] Configure custom domain
   - Go to Project Settings > Domains
   - Add custom domain: restorationgrowthpartners.com
   - Configure DNS with your registrar

5. [ ] Verify HTTPS is enabled
   - Vercel automatically provisions SSL certificate

## Post-Deployment (Analytics & SEO)

- [ ] Add Google Analytics
  - Create Google Analytics account
  - Add tracking code to every page in header
  - Verify traffic is being tracked

- [ ] Set up Google Search Console
  - Add property for restorationgrowthpartners.com
  - Upload sitemap.xml
  - Request indexing for main pages
  - Fix any crawler errors

- [ ] Set up Google Business Profile
  - Create business account
  - Verify location
  - Add photos, hours, description
  - Build review system

- [ ] Submit to search engines
  - Google Search Console (done above)
  - Bing Webmaster Tools
  - Yahoo Site Explorer

## Content Enhancement

- [ ] Expand blog with 10-15 more articles
  - Follow same template structure
  - Target high-value keywords
  - Include proper schema markup
  - Update blog index page

- [ ] Create location-specific pages
  - /markets/dallas/
  - /markets/houston/
  - /markets/phoenix/
  - /markets/denver/
  - (Add more markets based on service areas)

- [ ] Complete remaining service pages
  - /services/paid-advertising/
  - /services/website-design/
  - /services/reputation-management/
  - /services/content-marketing/

- [ ] Add customer testimonial videos
  - Create video section on homepage
  - Embed YouTube videos
  - Add quotes and attribution

## Marketing Integration

- [ ] Set up email capture
  - Install chatbot or popup
  - Lead magnet (free guide, audit, etc.)
  - Email list integration

- [ ] Create retargeting pixels
  - Facebook Pixel
  - Google Analytics Retargeting
  - LinkedIn Insight Tag

- [ ] Set up lead tracking
  - Phone call tracking
  - Form submission tracking
  - CRM integration

## Ongoing Maintenance

- [ ] Update blog monthly (1-2 new posts)
- [ ] Monitor search console for errors
- [ ] Review Google Analytics monthly
- [ ] Update testimonials quarterly
- [ ] Refresh case studies annually
- [ ] Monitor Core Web Vitals
- [ ] Test form submissions weekly
- [ ] Check all links quarterly

## Performance Optimization

- [ ] Monitor Lighthouse scores
  - Target: 90+ Performance
  - Target: 100 Accessibility
  - Target: 100 Best Practices
  - Target: 100 SEO

- [ ] Optimize images
  - Compress all images
  - Use WebP format where possible
  - Add alt text to all images

- [ ] Monitor page speed
  - Target: < 2 seconds load time
  - Use PageSpeed Insights
  - Monitor Core Web Vitals

## Security

- [ ] Enable HTTPS (automatic with Vercel)
- [ ] Set up security headers in vercel.json
- [ ] Regular security audits
- [ ] Monitor for security vulnerabilities
- [ ] Keep dependencies updated (if any)

## DNS Configuration (for Custom Domain)

When using your own domain registrar, configure:

1. A Record (or CNAME)
   - Point to Vercel's nameservers OR
   - Use CNAME: cname.vercel.sh

2. MX Records (if using same domain for email)
   - Configure email forwarding
   - Or use email service provider

3. TXT Records
   - Domain verification (if needed)
   - SPF records for email

## Success Metrics

Once deployed, target these metrics:

- [ ] Organic traffic growing month over month
- [ ] First page rankings for target keywords (3-6 months)
- [ ] Contact form submissions (monthly)
- [ ] Engagement metrics:
  - Bounce rate < 50%
  - Time on page > 2 minutes
  - Pages per session > 2.5

## Troubleshooting

**Page shows 404 error**
- Check vercel.json doesn't restrict file access
- Verify all link paths are correct
- Check sitemap.xml URLs match actual paths

**CSS not loading**
- Verify `/assets/style.css` path is correct
- Check CSS file permissions
- Clear browser cache (Ctrl+Shift+Delete)

**Forms not submitting**
- Verify form action points to correct endpoint
- Check email service is configured
- Test with form validation disabled first

**Content changes not showing**
- Push changes to GitHub
- Vercel automatically redeploys on push
- May take 1-2 minutes to deploy
- Clear browser cache

## Support Resources

- Vercel Docs: https://vercel.com/docs
- Google Search Console Help: https://support.google.com/webmasters
- PageSpeed Insights: https://pagespeed.web.dev
- Schema.org Reference: https://schema.org

---

**Status**: Ready for Deployment
**Last Updated**: April 28, 2026
**Contact**: hello@restorationgrowthpartners.com
