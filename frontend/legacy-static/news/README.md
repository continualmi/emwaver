# EMWaver Blog

Simple static HTML blog for EMWaver.

## Structure

- `index.html` - Blog homepage listing all posts
- `posts/` - Individual blog post HTML files
- No build process needed - just HTML files!

## Creating a New Post

1. Create a new HTML file in `posts/` folder (e.g., `posts/my-new-post.html`)
2. Copy the structure from `posts/welcome-to-emwaver.html`
3. Update the content
4. Add a link to the new post in `index.html`:
   ```html
   <li class="post-item">
       <div class="post-date">January 10, 2025</div>
       <h2 class="post-title"><a href="posts/my-new-post.html">My New Post</a></h2>
       <p class="post-excerpt">Brief excerpt of the post...</p>
   </li>
   ```

## Deployment

Just push to GitHub! GitHub Pages will serve the HTML files directly at `/blog/`.

No build process, no Jekyll, just simple HTML files.
