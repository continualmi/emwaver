from PIL import Image
import os

icons_dir = 'app/src-tauri/icons'

def fix_icon(filename, size):
    path = os.path.join(icons_dir, filename)
    print(f"Generating {path}...")
    # Create a simple blue icon with some transparency to ensure RGBA
    img = Image.new('RGBA', size, (0, 122, 204, 255)) 
    # Add a small transparent hole or distinct pixel to force RGBA if needed, 
    # but 'RGBA' mode in new() should be sufficient.
    img.putpixel((size[0]//2, size[1]//2), (255, 255, 255, 128))
    img.save(path, 'PNG')

fix_icon('32x32.png', (32, 32))
fix_icon('128x128.png', (128, 128))
fix_icon('128x128@2x.png', (256, 256))
fix_icon('icon.png', (512, 512))
print("Done.")
