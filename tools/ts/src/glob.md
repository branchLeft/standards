# glob.ts

Glob matching for `.standardsignore`, kept as a free-standing module (rather
than a class) because it is a pure function with no state and no dependency
to inject — `ARCH-5` groups such helpers under a namespace import instead of
leaving them loose.
