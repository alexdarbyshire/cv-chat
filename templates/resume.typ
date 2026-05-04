// One-page tailored resume. Forks edit this file to change visual identity;
// the JSON shape is contracted by lib/resume/schema.ts (ResumeJSON).
//
// Bumping the layout — fonts, spacing, sections — should also bump
// TEMPLATE_VERSION in lib/resume/render.ts so the Blob cache invalidates.

#let data = json.decode(sys.inputs.resume)

#set document(title: data.name + " — tailored resume")
#set page(
  paper: "a4",
  margin: (top: 1.4cm, bottom: 1.4cm, x: 1.6cm),
)
#set text(size: 10pt, font: ("Inter", "DejaVu Sans"))
#set par(leading: 0.55em, justify: false)

#let muted = rgb(95, 95, 100)
#let accent = rgb(15, 70, 130)
#let section(title) = block(
  above: 10pt,
  below: 4pt,
  text(size: 11pt, weight: "bold", fill: accent, upper(title)),
)

// Header
#text(size: 20pt, weight: "bold")[#data.name]
#v(-2pt)
#text(size: 11pt, fill: muted)[#data.headline]

#let socials = data.socials
#let social_links = ()
#if "linkedin" in socials [#{social_links.push(link(socials.linkedin)[LinkedIn])}]
#if "blog" in socials [#{social_links.push(link(socials.blog)[Blog])}]
#if "github" in socials [#{social_links.push(link(socials.github)[GitHub])}]
#if social_links.len() > 0 [
  #v(2pt)
  #text(size: 9pt, fill: muted)[#social_links.join(" · ")]
]

#v(6pt)

// Summary
#data.summary

#section[Highlights]
#list(..data.highlights)

#section[Experience]
#for role in data.roles [
  #grid(
    columns: (1fr, auto),
    align: (left, right),
    text(weight: "bold")[#role.title #text(weight: "regular", fill: muted)[ · ] #role.company],
    text(size: 9pt, fill: muted)[#role.period],
  )
  #list(..role.bullets)
  #v(2pt)
]

#if data.projects.len() > 0 [
  #section[Projects]
  #for p in data.projects [
    #if "url" in p [
      - #link(p.url)[*#p.name*] — #p.summary
    ] else [
      - *#p.name* — #p.summary
    ]
  ]
]

#section[Skills]
#text(size: 9.5pt)[#data.skills.join("  ·  ")]
