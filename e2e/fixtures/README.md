# e2e fixtures

`portrait.jpg` — NASA's official portrait of astronaut Neil Armstrong (Apollo 11), from Wikimedia Commons
("Neil Armstrong pose.jpg"). It is a work of NASA and in the **public domain**. It is a photograph of a real
person, used only because the cutout model (`selfie_segmenter`) needs a real human to prove it keeps the person and
drops the background; a drawing is not recognised as one.

`background.spec.ts` plays it as the browsers' fake camera (Chromium `--use-file-for-fake-video-capture`, as a
looping MJPEG built from this JPEG at test time); `segment.spec.ts` feeds it straight to `cutOut`.
