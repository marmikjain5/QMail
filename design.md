# Frontend Restyling Instructions

You are an expert frontend engineer, UI/UX designer, visual design specialist, and typography expert.

Your task is to **restyle the existing project using the design system below while preserving the existing project exactly as it is structurally and functionally.**

## 1. Critical Rule: Do Not Redesign the Project

**This is a visual restyling task, NOT a redesign or feature-development task.**

Before changing anything:

* Inspect the entire existing project.
* Understand its current tech stack, framework, component structure, routing, layouts, styling approach, and existing UI.
* Identify all existing pages, sections, components, buttons, forms, cards, navigation elements, images, icons, and other UI elements.
* Understand how the current styles are organized.
* Preserve the existing DOM/component structure wherever reasonably possible.

### Absolutely DO NOT:

* Add new pages.
* Add new sections.
* Add new components unless absolutely required to apply an existing style.
* Add new buttons.
* Add new cards.
* Add new forms.
* Add new navigation items.
* Add new text/content.
* Add new images or illustrations.
* Add new features.
* Add new functionality.
* Add new interactions.
* Add new animations that change behavior.
* Add new information that wasn't already present.
* Remove existing functionality.
* Remove existing content.
* Change API calls.
* Change business logic.
* Change state management.
* Change routing.
* Change authentication.
* Change form behavior.
* Change data flow.
* Change event handlers.
* Change backend integration.
* Change what buttons or links actually do.
* Change the number of UI elements merely to make the design look more complete.

**Do not "improve" the product by adding things. Improve only its visual presentation.**

If the existing page has 3 buttons, keep 3 buttons.

If it has 2 cards, keep 2 cards.

If it has no hero illustration, do not create one.

If it has a simple layout, keep that layout.

The existing project is the source of truth for **content, structure, functionality, and information architecture.**

---

# 2. What You ARE Allowed To Change

You may make visual and presentation-level changes to the existing elements.

You MAY:

* Change colors.
* Change typography.
* Change font sizes.
* Change font weights.
* Change line heights.
* Change letter spacing.
* Change spacing and padding.
* Change margins.
* Change widths and heights where needed for visual consistency.
* Change border colors.
* Change border radius.
* Change shadows.
* Change gradients.
* Change backgrounds.
* Change button styling.
* Change input styling.
* Change card styling.
* Change icon styling.
* Change existing icon colors.
* Change alignment.
* Change positioning of existing elements.
* Change grid/flex arrangements.
* Change responsive behavior of existing elements when necessary for a better layout.
* Improve visual hierarchy.
* Improve whitespace.
* Improve visual grouping.
* Add subtle hover/focus states to existing interactive elements.
* Add subtle transitions to existing interactions.
* Apply the supplied design tokens consistently.
* Apply subtle decorative effects to existing containers/backgrounds where they do not introduce new UI elements.

### Important distinction

You can **reposition an existing button**, but you cannot create another button.

You can **restyle an existing card**, but you cannot create another card.

You can **make an existing section visually richer**, but you cannot add another section.

You can **change an existing layout from horizontal to vertical on mobile**, but you cannot change what information the page contains.

---

# 3. Preserve Existing Functionality

This requirement is non-negotiable.

After restyling:

* Every existing button must still work.
* Every existing link must still work.
* Every existing form must still work.
* Every existing input must still work.
* Every existing API integration must still work.
* Every existing navigation route must still work.
* Every existing authentication flow must still work.
* Every existing state interaction must still work.
* Every existing modal/dropdown/menu must still work.
* Every existing responsive behavior must continue working.
* No JavaScript/business logic should be changed unless a purely visual change absolutely requires it.

Prefer changing **CSS/classes/styles** over changing application logic.

If an existing component already provides the required behavior, reuse it rather than replacing it.

---

# 4. Preserve The Existing Project's Full Layout

The restyled UI should use the **full available width and height of the existing application where the current layout allows it.**

Do not artificially constrain the application into a generic landing-page layout.

For example:

* If the current application has a full-width dashboard, keep it full-width.
* If it has a sidebar, keep the sidebar.
* If it has a top navigation, keep the top navigation.
* If it has a full-screen workspace, preserve that workspace.
* If the application uses multiple columns, preserve those columns.
* If the application has a large content area, allow it to use the available viewport appropriately.

Do not replace an existing application layout with:

`max-w-7xl mx-auto`

unless the existing project already uses that type of constraint or it is genuinely necessary for the existing content.

The design system should **adapt to the project**, not force the project into a predefined template.

---

# 5. Existing Architecture Comes First

Before writing code, identify:

### Technology

* Framework
* Language
* CSS solution
* Component library
* Utility framework
* Icon library
* Build system

### Styling

Identify:

* Existing global styles
* CSS variables
* Tailwind configuration
* Theme configuration
* Existing utility classes
* Existing component styles
* Existing typography system
* Existing color variables

### Components

Understand:

* Component hierarchy
* Naming conventions
* Reusable components
* Layout components
* Page components
* Shared UI components

### Constraints

Look for:

* Legacy CSS
* Existing design libraries
* Third-party components
* Performance constraints
* Existing responsive rules
* Existing accessibility patterns

**Match the existing project's conventions.**

Do not introduce a completely different styling architecture simply because the design system uses different terminology.

---

# 6. Design System To Apply

## Design Philosophy

Apply the following visual language to the **existing UI elements only**:

**Corporate Trust**

Modern enterprise SaaS aesthetic:

* Professional
* Approachable
* Vibrant
* Polished
* Dimensional
* Modern
* Trustworthy
* Enterprise-ready

The visual signature should come from:

1. Indigo and violet accents
2. Soft colored shadows
3. Gradient accents
4. Refined typography
5. Elevated existing cards
6. Subtle depth
7. Generous but appropriate spacing
8. Polished interactions

Do not force every effect onto every component. Use them selectively.

---

# 7. Design Tokens

## Colors

Background:

`#F8FAFC`

Surface:

`#FFFFFF`

Primary:

`#4F46E5`

Secondary:

`#7C3AED`

Main Text:

`#0F172A`

Muted Text:

`#64748B`

Success:

`#10B981`

Border:

`#E2E8F0`

Use these consistently rather than introducing many unrelated colors.

---

# 8. Typography

Preferred font:

**Plus Jakarta Sans**

Use:

* 800 for major headings
* 700 for section headings
* 600 for important labels/card titles
* 500 for navigation and labels
* 400 for body text

Headlines:

* Tight line height around `1.1`
* Letter spacing around `-0.02em`

Body:

* Comfortable line height around `1.6–1.7`

Maintain the existing information hierarchy.

Do not rewrite text simply to make the typography work.

---

# 9. Existing Buttons

Restyle the buttons that already exist.

### Primary buttons

Use:

* Indigo → violet gradient
* White text
* Rounded corners
* Soft indigo shadow
* Subtle hover lift
* Smooth transition

Example visual direction:

`from-indigo-600 to-violet-600`

with a subtle colored shadow.

### Secondary buttons

Use:

* White background
* Slate border
* Slate text
* Soft hover background

Do not create additional CTA buttons.

---

# 10. Existing Cards

For cards that already exist:

* White surface
* `rounded-xl`
* Subtle border
* Soft indigo-tinted shadow
* Slight hover elevation where appropriate

Default shadow:

`0 4px 20px -2px rgba(79, 70, 229, 0.1)`

Hover shadow:

`0 10px 25px -5px rgba(79, 70, 229, 0.15), 0 8px 10px -6px rgba(79, 70, 229, 0.1)`

Use hover elevation only on elements that are already interactive or naturally card-like.

---

# 11. Existing Inputs

For existing inputs:

* White background
* Slate border
* `rounded-lg`
* Clear labels
* Indigo focus state
* Visible keyboard focus

Focus:

`ring-2 ring-indigo-500 ring-offset-1`

Do not add inputs.

---

# 12. Depth And Visual Polish

Use depth carefully.

Allowed:

* Soft colored shadows
* Existing cards lifting slightly
* Existing containers receiving subtle gradients
* Existing elements receiving subtle 3D perspective
* Existing backgrounds receiving very subtle atmospheric gradients

Avoid turning the entire application into a 3D scene.

The visual hierarchy should remain professional.

---

# 13. Gradients

Use gradients strategically.

Primary:

`from-indigo-600 to-violet-600`

Text gradients may be used for **existing headings** where appropriate.

Subtle backgrounds may use:

`from-indigo-100 to-violet-100`

Dark existing CTA sections may use:

`from-indigo-900 to-indigo-950`

Do not add a new CTA section just to use a gradient.

---

# 14. Existing Icons

If the project already uses icons:

* Preserve the existing icons and their meaning.
* Restyle their size/color where appropriate.
* Use Lucide-style visual treatment if Lucide is already part of the project.
* Do not replace icons unnecessarily.
* Do not add decorative icons merely to fill empty space.

Icons should generally use:

* `h-4 w-4` inline
* `h-5 w-5` standard UI
* `h-6 w-6` prominent existing UI

---

# 15. Responsive Design

The existing application must remain fully responsive.

Use mobile-first adjustments where necessary.

### Mobile

* Preserve all existing functionality.
* Stack existing elements when required.
* Prevent horizontal overflow.
* Maintain readable typography.
* Keep interactive targets at least 44×44px.
* Preserve the existing information hierarchy.

### Desktop

* Make effective use of available width.
* Preserve the existing layout structure.
* Avoid unnecessarily narrow content areas.
* Maintain balanced whitespace.

Do not redesign the mobile experience into a different product.

---

# 16. Accessibility

Preserve and improve accessibility.

Ensure:

* WCAG AA contrast where applicable.
* Visible focus states.
* Semantic HTML remains intact.
* Existing keyboard interactions continue working.
* Existing screen-reader behavior is not broken.
* Images retain meaningful alt text.
* Decorative icons remain hidden from screen readers when appropriate.
* Reduced-motion preferences are respected.

Do not sacrifice accessibility for visual effects.

---

# 17. Animation

Use restrained, professional motion.

Allowed:

* `duration-200`
* `ease-out`
* subtle hover elevation
* subtle button lift
* subtle icon movement
* existing image zoom
* subtle transitions

Avoid:

* Excessive bouncing
* Large movements
* Distracting animations
* Auto-playing decorative motion everywhere
* Animations that interfere with interaction

The interface should feel polished, not animated for the sake of being animated.

---

# 18. Implementation Strategy

Follow this order:

### Step 1: Inspect

Understand the complete existing project.

### Step 2: Map

Identify:

* Existing pages
* Existing layouts
* Existing components
* Existing styles
* Existing reusable patterns
* Existing responsive behavior

### Step 3: Establish Tokens

Where appropriate, centralize the design tokens rather than scattering arbitrary values throughout the codebase.

Prefer existing theme variables/configuration if the project already has them.

### Step 4: Restyle Existing Primitives

Update existing:

* Typography
* Buttons
* Inputs
* Cards
* Navigation
* Containers
* Existing interactive elements

### Step 5: Restyle Existing Pages

Apply the system consistently across the existing pages.

### Step 6: Responsive Pass

Check the existing UI at:

* 375px
* 640px
* 768px
* 1024px
* 1280px+

### Step 7: Functionality Check

Verify that no functionality was changed.

---

# 19. Code Quality Rules

Prefer:

* Reusable styles
* Existing components
* Existing utility classes
* Centralized tokens
* Consistent naming
* Minimal duplication
* Small, targeted changes

Avoid:

* One-off arbitrary styles everywhere
* Duplicating existing components
* Rewriting working logic
* Creating unnecessary abstractions
* Introducing unnecessary dependencies
* Changing the project's architecture

**Make the smallest code changes necessary to achieve a significantly better visual result.**

---

# 20. Final Constraint

Before considering the work complete, ask:

> "Did I change how the application looks, or did I accidentally change what the application is?"

The answer must be:

**I changed how it looks. I did not change what it is.**

The final result should feel like the **same application, same pages, same content, same components, same functionality, and same workflows**, but with a much more polished Corporate Trust visual identity.

**Do not add anything merely because the design system mentions it.**

If the existing project does not contain a hero, do not add a hero.

If it does not contain pricing, do not add pricing.

If it does not contain statistics, do not add statistics.

If it does not contain decorative graphics, do not add decorative graphics.

**Existing project structure and functionality always take priority over the design system.**
