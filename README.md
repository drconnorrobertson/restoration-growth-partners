# Restoration Growth Partners - Static Website

A complete, SEO-optimized static website for Restoration Growth Partners (restorationgrowthpartners.com). Built with HTML, CSS, and no dependencies for fast, reliable hosting on Vercel or similar platforms.

## Site Structure

```
restoration-growth-partners/
├── index.html                          # Homepage
├── assets/
│   └── style.css                       # Global styles
├── about/
│   └── index.html                      # About Us page
├── services/
│   ├── index.html                      # Services overview
│   ├── restoration-seo/
│   │   └── index.html                  # SEO service page
│   ├── google-business-profile/
│   │   └── index.html                  # GBP service page
│   ├── paid-advertising/               # Directory for future content
│   ├── website-design/                 # Directory for future content
│   ├── reputation-management/          # Directory for future content
│   └── content-marketing/              # Directory for future content
├── blog/
│   ├── index.html                      # Blog overview
│   ├── water-damage-lead-generation.html
│   ├── google-maps-ranking.html
│   └── angi-33mile-alternatives.html
├── case-studies/
│   └── index.html                      # Case studies page
├── our-process/
│   └── index.html                      # Our Process page
├── pricing/
│   └── index.html                      # Pricing page
├── faq/
│   └── index.html                      # FAQ page
├── contact/
│   └── index.html                      # Contact page
├── sitemap.xml                         # XML sitemap for search engines
├── robots.txt                          # Search engine crawling rules
└── README.md                           # This file
```

## Features

- **SEO Optimized**: Full schema markup, proper meta tags, structured data, breadcrumbs
- **Mobile Responsive**: Professional design that works on all devices
- **Fast**: Pure HTML and CSS, no JavaScript frameworks (minimal JS for interactivity)
- **Professional Design**: Using Inter and Playfair Display fonts with brand colors
- **Unique Content**: 15+ pages with original, substantive content focused on restoration marketing
- **Blog Posts**: Multiple 1500+ word blog posts with unique strategies and insights
- **Easy to Deploy**: Static files ready for Vercel, Netlify, GitHub Pages, or any static host

## Brand Colors

- Primary Blue: `#2B5797`
- Accent Orange: `#E8642C`

## Fonts

- Body: Inter (sans-serif)
- Headings: Playfair Display (serif)
- Loaded from Google Fonts

## Pages Created

### Main Pages
- **Homepage** - Hero section, value prop, services preview, case studies, testimonials, FAQ preview, CTA
- **About Us** - Company mission, why we do this, approach, track record
- **Our Process** - 6-phase system, timeline, what makes it different, expected results
- **Services** - Complete overview of all services with cards
- **Case Studies** - 3 detailed case studies showing real results
- **Pricing** - 3 packages (Foundation, Growth System, Scale) with feature comparisons
- **FAQ** - 15+ common questions with detailed answers
- **Contact** - Contact form and consultation booking

### Service Pages
- **Restoration SEO** - Complete guide to ranking on Google with keywords, process, timeline
- **Google Business Profile Optimization** - Strategy, checklist, timeline, optimization steps
- Additional service pages (Paid Advertising, Website Design, Reputation Management, Content Marketing) - directories ready for content

### Blog Pages
- **Water Damage Lead Generation** - 8 proven strategies for generating qualified leads
- **Google Maps Ranking** - Complete guide to ranking #1 on Google Maps
- **Angi's List & 33Mile Alternatives** - Math behind marketplace costs and better alternatives
- Blog overview page with feature articles and more resources
- Additional blog placeholders for 10+ more articles

## Deployment

### Deploy on Vercel

1. Push this repository to GitHub:
```bash
git remote add origin https://github.com/yourusername/restoration-growth-partners.git
git branch -M main
git push -u origin main
```

2. Go to vercel.com, sign in, and import the repository
3. Vercel will automatically detect it as a static site
4. Configure custom domain in Vercel settings
5. Deploy!

### Deploy on Netlify

1. Push to GitHub (see above)
2. Go to netlify.com and create new site from Git
3. Select your repository
4. Netlify will auto-detect settings for static site
5. Configure custom domain
6. Deploy!

### Deploy on GitHub Pages

1. Push to GitHub
2. Go to repository Settings > Pages
3. Select main branch as source
4. GitHub Pages will deploy automatically

## Customization

### Update Brand Information

Edit the footer and header sections to update:
- Company name and description
- Contact information
- Social media links
- Service offerings
- Team information

### Add More Blog Posts

1. Create new HTML files in `/blog/` directory
2. Use existing blog posts as template
3. Include proper schema markup for articles
4. Add to `/blog/index.html` listing
5. Update `sitemap.xml`

### Modify Colors

Edit the CSS variables at the top of `/assets/style.css`:
```css
:root {
  --primary-blue: #2B5797;
  --accent-orange: #E8642C;
  /* ... other colors ... */
}
```

### Update Content

All content is in HTML files. Edit directly in any text editor or IDE. The structure follows this pattern:
- Page header with meta tags and schema markup
- Navigation header
- Breadcrumbs
- Hero section
- Content sections with proper hierarchy
- Footer

## SEO Considerations

- All pages have proper title tags and meta descriptions
- Schema markup included for Organization, LocalBusiness, BreadcrumbList, Article, FAQ
- Sitemap.xml for search engine discovery
- Robots.txt for crawling guidance
- Proper heading hierarchy (H1, H2, H3, etc.)
- Mobile responsive design (mobile-first)
- Fast loading (no heavy assets)

## Performance

- No external dependencies (except Google Fonts)
- Pure HTML and CSS
- Minimal JavaScript (only for FAQ toggles and form interactivity)
- Optimized for Core Web Vitals

## Next Steps

1. Update contact form to connect to email service (Formspree, Netlify Forms, etc.)
2. Add Google Analytics tracking code
3. Add Google Search Console verification
4. Create location-specific landing pages for major service areas
5. Expand blog with 10-15 more articles on restoration marketing topics
6. Create market-specific variations (Dallas, Houston, Phoenix, Denver, etc.)
7. Add customer testimonial videos
8. Implement chatbot for lead capture

## Folder Structure for Additional Services

Directories are pre-created for remaining service pages. Create `index.html` files in:
- `/services/paid-advertising/index.html`
- `/services/website-design/index.html`
- `/services/reputation-management/index.html`
- `/services/content-marketing/index.html`

Use `/services/restoration-seo/index.html` as a template.

## Git Workflow

The repository is initialized and ready for deployment. Current status:
- All files committed
- Ready to push to GitHub
- Ready to deploy on Vercel, Netlify, or GitHub Pages

```bash
# View commit history
git log

# Make changes
git add .
git commit -m "Your message"
git push
```

## Support

This static website is built to be simple, fast, and easy to maintain. All content is in HTML files. No database, no server-side code, no complex dependencies.

For deployment help:
- Vercel: https://vercel.com/docs
- Netlify: https://docs.netlify.com
- GitHub Pages: https://pages.github.com

---

**Created**: April 28, 2026
**Status**: Ready for Production Deployment
