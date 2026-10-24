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

In my honest opinion, both options kind of suck here. 
Push based has the coupling problems (the blog repo has to know about its subscribers), and the pull approach means updates can be delayed, and we risk being rate limited by GitHub. 


Ultimately, I decided on push-based, mainly for simplicity, but also because we need coupling no matter what:
to get eligibility checking, we need some way of letting the blog tell if a **Github User** making a Pull Request is **in the Discord** and over Level 30.

The implementation of this is quite simple: have the Discord Bot register a GitHub OAuth app which links your accounts, and then expose a tiny HTTP API to query a Discord user from a GitHub user.
Initially, I wanted to make this API public to simplify the coupling, until I realised this is kind of a terrible idea from a privacy perspective -- a public way to get someone's Discord username from their GitHub account is not a good idea.

So, we need some coupling either way. In this case, we went with the simplest possible solution: the API requires a secret token that only the blog's GitHub Secrets knows.

### Dating

Initially, posts had a simple date field in their frontmatter to mark when they're published.
I wasn't a big fan of this -- it's another possible point of failure, whether from accidentally omitting the field or putting the wrong value.
This adds extra complexity to both the author and the validation code. 

Fortunately, a far more elegant solution comes for free: **the Git history**!
We simply say that a post was published whenever its .md file was first added into the master branch. No ambiguity, no manual checks needed, it just works! :)


## Implementation

### The Bot

The Discord Bot contained the smallest set of changes overall. The additions boiled down to 3 things:
1. Adding the GitHub Linking (mostly already done in a PR by Rooki, conveniently)
2. Adding the authenticated HTTP API
3. Adding another HTTP API that the blog can call to say "some new posts were added, please post them to the server"

There is not really much interesting going on here to be honest

### The Website

For the website implementation, we conveniently are already using [`elm-pages`](https://elm-pages.com/), 
a framework for making static sites in the [Elm](https://elm-lang.org) programming language. This is useful
because it already comes with support for generating pages from Markdown files,
while still allowing us to add our own processing and content around it.

elm-pages has an ahead-of-time build stage that turns the Elm into mostly-static HTML. 
This has a few pros and cons: the website is faster and more SEO friendly, 
but when the pages' content come from an external source, it becomes a bit more difficult to work with.
We can't dynamically lookup a blog post's content since everything has to be static

No matter! We can make the best of this. We added a new build stage that clones the blog repository, does some basic sanity checks,
and then processes the posts to be compatible with elm-pages. This involves stuff like moving images to the right directory so relative URLs work,
and indexing all the posts by author and tags to generate the pages for those. Every post gets its own Elm page,
with SEO and all the nicities of a normal website. The git-based publishing date feature is also much more convenient this way.Doing these things dynamically would be way harder, and probably involve some kind of permanently running API for the blog posts.

Doing everything statically also means we can do syntax highlighting at compile time, which 
is a lot faster and avoids more client-side JavaScript. In the future we might do stuff like image compression or an RSS feed too.

And that's pretty much it! A few TypeScript scripts for build-time processing, a couple new Elm files per page, and some fairly simple CSS. Nice!

The only other thing worth mentioning here is the GitHub Actions wiring: the website repository has an action that rebuilds and redeploys the
site with the latest blog contents. It uses the `repository_dispatch` trigger so that the blog repository can tell the website to rebuild itself when a new
post is added. This unfortunately is breaking motivation 4 a little, but it's the simplest possible solution that's fairly reliable

### The Blog

The hardest bit was coming up with some good rules for posting! The blog is deliberately very simple: 
a folder for optional author bios, and then one folder per post.
In order to achieve our motivation of keeping it simple, we want two things: **automated reviews with good feedback** and **any code out of the way** to not intimidate beginners.

The `tools` folder contains the bulk of this code: a small TypeScript Tool that validates
all the posts in the repository, or all the posts changed in a Pull Request.

These validation checks are quite involved and designed to be "idiot-proof" (not in a condescending way!). We check for lots of possible
mistakes, and try to give detailed explanations for how to fix the issue. 
Where GitHub allows us, we submit the feedback as diff review comments on the problematic lines, and otherwise as a general comment.
This can be ran locally to test before you commit too! 

Whenever a PR is made, we run this script to check that any changes are okay. If so, it's time for a human content review!

Finally, on a merge to master, we run a separate action to signal to the two services (web and bot) that they can update.

TypeScript was mainly chosen because it has good support (e.g. a GitHub API library), is quick to write,
and still gives us a reasonable degree of safety. Plus, I quite like it. There are probably better choices but they would've taken so much longer to make this in :)


--- 

Anyway, thanks for reading! This first draft was written on my phone so it probably isn't the best formatting,
but I hope this was entertaining enough :) More importantly, I'm excited to see what posts everyone submits to the blog!