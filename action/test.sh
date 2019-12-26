ffmpeg -i ../../data/342896126.mp4 -i ../../data/342896126.mp4 \
-filter_complex "[0:v:0] [0:a:0] [1:v:0] [1:a:0] concat=n=2:v=1:a=1 [v] [a]" \
-map "[v]" -map "[a]" -vcodec rawvideo output.mkv


