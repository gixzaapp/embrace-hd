---
name: Neon Nocturne
colors:
  surface: '#111415'
  surface-dim: '#111415'
  surface-bright: '#373a3b'
  surface-container-lowest: '#0c0f10'
  surface-container-low: '#191c1d'
  surface-container: '#1d2021'
  surface-container-high: '#282a2b'
  surface-container-highest: '#323536'
  on-surface: '#e1e3e4'
  on-surface-variant: '#bbcac0'
  inverse-surface: '#e1e3e4'
  inverse-on-surface: '#2e3132'
  outline: '#85948b'
  outline-variant: '#3c4a42'
  surface-tint: '#45dfa4'
  primary: '#5af0b3'
  on-primary: '#003825'
  primary-container: '#34d399'
  on-primary-container: '#00563b'
  inverse-primary: '#006c4b'
  secondary: '#bfc6db'
  on-secondary: '#293041'
  secondary-container: '#3f4758'
  on-secondary-container: '#adb5c9'
  tertiary: '#cdd8ea'
  on-tertiary: '#27313f'
  tertiary-container: '#b2bcce'
  on-tertiary-container: '#414c5b'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#68fcbf'
  primary-fixed-dim: '#45dfa4'
  on-primary-fixed: '#002114'
  on-primary-fixed-variant: '#005137'
  secondary-fixed: '#dbe2f8'
  secondary-fixed-dim: '#bfc6db'
  on-secondary-fixed: '#141c2b'
  on-secondary-fixed-variant: '#3f4758'
  tertiary-fixed: '#d9e3f6'
  tertiary-fixed-dim: '#bdc7d9'
  on-tertiary-fixed: '#121c2a'
  on-tertiary-fixed-variant: '#3d4756'
  background: '#111415'
  on-background: '#e1e3e4'
  surface-variant: '#323536'
typography:
  headline-lg:
    fontFamily: Hanken Grotesk
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.02em
  headline-lg-mobile:
    fontFamily: Hanken Grotesk
    fontSize: 28px
    fontWeight: '700'
    lineHeight: 34px
  headline-md:
    fontFamily: Hanken Grotesk
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  body-lg:
    fontFamily: Hanken Grotesk
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 28px
  body-md:
    fontFamily: Hanken Grotesk
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  label-caps:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.1em
  button-text:
    fontFamily: Hanken Grotesk
    fontSize: 14px
    fontWeight: '700'
    lineHeight: 20px
    letterSpacing: 0.05em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  margin-page: 24px
  gutter: 16px
  stack-sm: 8px
  stack-md: 16px
  stack-lg: 32px
---

## Brand & Style

This design system is built on a "Dark Mode First" philosophy, optimized for high-impact marketing visuals and Play Store presence. The brand personality is technical, precise, and energetic, evoking a sense of high-performance utility.

The visual style is a hybrid of **Minimalism** and **Cyber-Technic**. It utilizes deep, ink-like backgrounds to provide maximum contrast for vibrant neon accents. The goal is to make the interface feel like a premium "Pro" tool that is both powerful and easy to navigate. By using glowing elements sparingly, we create a clear focal point for conversion actions and brand recognition.

Target Audience: Tech-savvy users, content creators, and individuals looking for high-quality utility tools that feel modern and sophisticated.

## Colors

The palette is dominated by "Deep Space" tones to ensure the neon accents truly "pop" on mobile screens.

- **Primary (#34D399):** A vibrant, electric emerald used for call-to-action buttons, progress indicators, and active states. It carries a subtle outer glow (0px 0px 12px) in high-priority contexts.
- **Secondary (#101827):** The core background color. A near-black navy that prevents the "crushed blacks" of pure OLED black while maintaining a premium dark aesthetic.
- **Tertiary (#1F2937):** Used for card backgrounds and container surfaces to create subtle depth against the secondary background.
- **Neutral (#F9FAFB):** Reserved for primary text and high-contrast icons to ensure maximum readability.
- **Surface Accents:** Use high-transparency versions of the primary color (10-15% opacity) for subtle borders and secondary button backgrounds.

## Typography

The typography strategy blends the clean, modern geometry of **Hanken Grotesk** with the technical, monospaced precision of **JetBrains Mono**.

- **Headlines:** Use Hanken Grotesk with tight tracking and bold weights to command attention in marketing screenshots.
- **Body Text:** Hanken Grotesk provides excellent legibility at smaller scales. Use a slightly muted white (85% opacity) for secondary descriptions to maintain hierarchy.
- **Technical Labels:** All-caps JetBrains Mono is used for category headers, metadata (like file sizes/durations), and secondary status indicators to reinforce the "technical" nature of the tool.

## Layout & Spacing

The design system utilizes a **Fluid Grid** with generous safe-area margins to ensure content feels breathable even on smaller devices.

- **Grid:** A 12-column layout for desktop/tablet, collapsing to a single-column stack on mobile.
- **Margins:** A standard 24px margin on mobile prevents content from feeling cramped against device edges—critical for marketing screenshots.
- **Rhythm:** Spacing follows an 8px base unit. Component internal padding should default to 16px (stack-md), while section-to-section spacing should use 32px (stack-lg) to clearly demarcate different features.
- **Marketing Specifics:** For Play Store screenshots, increase the "stack-lg" to 48px to allow for prominent headline text above the UI mockups.

## Elevation & Depth

Hierarchy is achieved through **Tonal Layers** and **Low-Contrast Outlines** rather than traditional shadows.

1.  **Base Layer:** The deepest navy (#101827).
2.  **Raised Layer:** Cards and containers use #1F2937. These should have a subtle 1px border using a slightly lighter grey or a 10% opacity primary green.
3.  **Accent Depth:** High-priority cards (like "Premium" or "Active Task") can use a thin, solid primary-colored border (#34D399) to pull the element forward.
4.  **Glow:** Reserve the "glow" effect (drop-shadow with primary color spread) exclusively for the logo and the primary action button on any given screen.

## Shapes

The shape language is "Modern-Friendly"—sharp enough to look professional, but rounded enough to feel accessible.

- **Primary Containers:** 0.5rem (8px) corner radius for most cards and input fields.
- **Buttons:** 0.5rem for standard buttons. For "pills" or "chips," use the full rounded-xl (1.5rem) to distinguish them from actionable containers.
- **Progress Bars:** Use a 4px (Soft) radius for the track and the fill to keep them sleek.

## Components

### Buttons
- **Primary:** Solid #34D399 background with dark navy text. Heavy weight. Includes a subtle glow in marketing contexts.
- **Secondary/Outline:** Transparent background with a 1px border of primary green or high-opacity white. All-caps typography.

### Cards
- Use #1F2937 background.
- Include a 1px border (#ffffff at 10% opacity) to define edges against the dark background.
- Padding should be a consistent 20px.

### Input Fields & Selection
- **Tabs/Switchers:** Use a dark container with a primary green highlight for the active state.
- **Chips:** Small, rounded-xl containers with JetBrains Mono text. Use for metadata like "1080P" or "9:16".

### Progress Indicators
- Linear tracks using a 20% opacity primary color.
- Active fill using solid #34D399.
- Status text should appear above the bar, aligned to the right.

### Navigation
- Bottom navigation uses a solid dark background with a 1px top border.
- Active items are indicated by an icon color change to #34D399 and a subtle label highlight.