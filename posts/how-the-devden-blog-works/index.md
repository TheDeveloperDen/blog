--- 
title: How the DevDen Blog Works
authors: [bristermitten]
summary: A high level technical overview of how the blog you're reading was built!
tags: [official, tutorial]
---

The technology behind this blog isn't super advanced, but it did require some interesting design decisions. 
In this post, I'll go into these decisions and try to justify them, in an informative way!

## Motivation

At a high level, the motivation is pretty obvious: make a blog for DevDen users to post on.
From a technical and design perspective we have a few more constraints:
1. The content should be hosted in a way that we can have **multiple consumers**: in particular, we want _at least_ our Elm [website](https://github.com/TheDeveloperDen/website)], and our [Discord Bot](https://github.com/TheDeveloperDen/discord-bot) to be able to render the posts
2. Contributing should be **access controlled** (so only trusted users can post)
3. Contributing should be as **simple as possible**, we don't want to scare off users by requiring a lot of technical knowledge
4. Avoiding **strong coupling** -- the architecture shouldn't need every service (e.g. the blog and website) to tightly depend on the others
5. The experience should feel **polished** and smoothly integrated within the rest of our "brand"

## Initial Ideas

If I was a LAZY developer I would've simply setup a premade [Astro](https://astro.build/) site on a separate subdomain,
and called it a day. From some perspectives, this is ideal: we don't reinvent the wheel, Astro has a wide ecosystem of plugins and themes,
and hey, it just works.

Unfortunately, this would make basically all of our motivations difficult: Astro's MDX format, while expressive,
is not that portable. It's also much more technical than plain Markdown, allowing mixing-in JavaScript code,
and certainly wouldn't feel very polished as a separate thing from our main website.
If we wanted a similar web design, we'd have to spend a lot of time copying our website's CSS rules.

Motivation 3 also means that a standalone repo is better, rather than e.g. a subdirectory in the website repo.

In terms of technical architecture, we need to weigh up a **push vs pull architecture**:
- A push-based architecture would involve the blog repository sending "push" notifications to the clients saying "a new post was added!"
- A pull-based architecture instead makes all the clients "subscribe" to the blog's source. In practice, this usually involves them repeatedly checking "did a new post arrive?".

In my honest opinion, both options kind of suck here. Push based has the coupling problems (the blog repo has to know about its subscribers), and the pull approach means updates can be delayed, and we risk being rate limited by GitHub.