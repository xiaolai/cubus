// Where a course sits beside the app, and the tag that tells the page so (ADR 0007).
//
// ONE spelling, for the two places that put a course beside the app: the dev server, which mounts one
// from `CUBUS_COURSE_DIR` for authoring, and `build.mjs`, which bundles one into a release. Two spellings
// of the tag would let a release name a directory the build never wrote — and the page installs a course
// only when the tag is present (`installCourseFromPage`), so that mistake is a shelf that fails to load.

/** The directory a course occupies beside the app, as the page's tag names it. */
export const COURSE_MOUNT = 'course';

/** The tag `lib/course-session.js` reads: `<meta name="cubus-course" content="course/">`. */
export const COURSE_META = `<meta name="cubus-course" content="${COURSE_MOUNT}/">`;
