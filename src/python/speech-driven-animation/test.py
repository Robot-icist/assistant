import sda
va = sda.VideoAnimator(model_path="grid")  # Instantiate the animator
vid, aud = va("example/image.bmp", "example/audio.wav")
va.save_video(vid, aud, "generated.mp4")