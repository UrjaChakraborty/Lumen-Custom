import React, { useEffect, useRef, useState } from "react";
import landing from "../styles/Landing.module.css";

const NAV_SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "how-its-built", label: "Our Approach" },
  { id: "limits", label: "What It Does Not Do" },
  { id: "the-team", label: "Our Team" },
];

const GLANCE = [
  {
    label: "Built for",
    value: "Chicago Public Schools",
    href: "https://www.cps.edu",
  },
  {
    label: "Built at",
    value: "Discovery Partners Institute",
    href: "https://dpi.illinois.edu",
  },
  {
    label: "Contact",
    value: "rukminia@uillinois.edu",
    href: "mailto:rukminia@uillinois.edu",
  },
];

const OVERVIEW_LEAD =
  "Lumen helps high school STEM teachers draft lessons, activities, assessments, and " +
  "feedback for the classes they actually teach.";

const OVERVIEW_PARAS = [
  "You set up your classes once. Every draft then starts prefilled with that section's " +
    "course, grade, period length, reading level, and tech setup, so you are not retyping " +
    "context on every request. Describe the topic, add what you know about your students " +
    "and community, then choose Minimal, Collaborative, or Full Draft. The selected level " +
    "guides the AI response, from brainstorming ideas through a complete lesson plan.",
  "Drafts come from Google Gemini, called from Lumen's own server. Your browser never " +
    "talks to Google directly and the API key is never sent to your browser. When no " +
    "generation service is reachable, Lumen reports that it could not reach the AI and " +
    "offers a local template draft only if you choose that alternative.",
  "Everything you make is saved in your own browser. There is no Lumen account and no " +
    "Lumen database, which also means clearing your browser data deletes your work and it " +
    "does not follow you to another computer. The backup on the Method page is the only " +
    "copy that survives either.",
  "This is a drafting tool, not a teaching one. Read every draft against your actual " +
    "students before you use it.",
];

const APPROACH_LEAD =
  "Lumen checks its own output in code, and says plainly what it cannot check.";

const FEATURES = [
  {
    title: "Student information is blocked, not just discouraged",
    desc:
      "Lumen screens what you type before anything is sent, and refuses the request if it " +
      "finds a name beside an IEP or 504 reference, a student ID, an email address, a phone " +
      "number, or a date of birth. You are shown exactly what it matched. The same screen " +
      "runs on the server, so it holds for every route that reaches the model, not only the " +
      "ones the page happens to use.",
  },
  {
    title: "Claims that can be checked are checked",
    desc:
      "Section minutes are added up against your period length. Group counts and copy counts " +
      "are reconciled against your class size. Every numeric answer in an answer key is " +
      "solved a second time by a model that is never shown the proposed answer, and the " +
      "arithmetic inside a worked solution is evaluated by a calculator rather than asked " +
      "about. Where two answers disagree, both are shown and neither is quietly corrected.",
  },
  {
    title: "Standards come from a list, not from memory",
    desc:
      "Lumen retrieves candidate standards from a local dataset of 18 NGSS and Common Core " +
      "math standards, the model picks from that list, and the choice is checked against the " +
      "list again in code. A code that is not in the dataset is dropped. The dataset covers " +
      "science and mathematics only, so if you teach outside those you will see few " +
      "standards or none.",
  },
  {
    title: "It cannot cite anything, and does not pretend to",
    desc:
      "Lumen has no search tool and no document library, so any citation it produced would be " +
      "invented. The sources block is not written by the model at all: it is derived from the " +
      "blanks left for you to fill, the figures traced back to what you typed, and the " +
      "lesson's own timing. Citation-shaped text is detected and removed from drafts.",
  },
  {
    title: "Culturally responsive and universally designed",
    desc:
      "Lumen builds on Culturally Responsive Pedagogy and Universal Design for Learning. " +
      "Cultural connections are drawn only from the student interests and community context " +
      "you write yourself, never inferred from a grade, a course, or a neighbourhood. If you " +
      "leave those blank, Lumen says it needs them rather than guessing. Accessibility " +
      "supports cite CAST UDL checkpoints, and an invented checkpoint id is dropped.",
  },
  {
    title: "Usable on the devices teachers actually have",
    desc:
      "Every screen works down to a 320px phone. Controls meet a 44px touch target, keyboard " +
      "focus stays visible throughout, text meets WCAG AA contrast in both light and dark, " +
      "and animation is dropped for anyone who asks their device to reduce motion.",
  },
];

const STEPS = [
  {
    title: "Choose how to start",
    desc: "Adapt a worked example, reopen something you already made, or start from a blank sheet.",
  },
  {
    title: "Describe the class",
    desc:
      "Prefilled from the class you are planning for. Add the topic, and the community context " +
      "and student interests the cultural connection will be built from.",
  },
  {
    title: "Read the draft, and what was checked",
    desc:
      "Every draft carries a short list of what Lumen verified, in three states: checked and " +
      "fine, checked and not, and not checked. The third is never folded into the first.",
  },
];

// What Lumen does NOT do. On the page as its own section, in the same register as
// the privacy note: a tool that lists only its strengths is not describing itself.
const LIMITS = [
  "It does not judge cultural fit. No automated check can tell you whether a lesson " +
    "describes your actual students or a group they belong to. That reading is yours, and " +
    "Lumen says so on every draft rather than scoring it.",
  "Misconceptions, safety notes, IEP-style accommodations and Spanish cognates are the " +
    "model's word. There is no corpus to check them against, and the Method page marks them " +
    "as unverified rather than implying otherwise.",
  "No prompt makes a language model incapable of inventing. Lumen reduces the surface by " +
    "removing claims it cannot ground, recomputing what can be recomputed, and labelling " +
    "the rest. It does not eliminate the possibility, and a tool claiming it did would be " +
    "making exactly the kind of unearned promise this one is built to avoid.",
  "Nothing here is legal advice, and nothing here replaces your district's guidance on " +
    "student data or AI use. Confirm the current Gemini API terms with your district before " +
    "using this with real class data.",
];

const TEAM = [
  { name: "Rukmini Avadhanam", role: "Project Host", wide: true },
  { name: "Kevin Mei", role: "Project Team" },
  { name: "Brynn Walker", role: "Project Team" },
];

function initials(name) {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export default function About() {
  const [activeSection, setActiveSection] = useState("overview");
  // Height of the site's sticky top nav, so the mobile sticky header (title +
  // section nav) docks directly beneath it instead of sliding underneath.
  const [navHeight, setNavHeight] = useState(0);
  // Ignore scroll-spy briefly after a sidebar click so hash/programmatic
  // jumps don't fight the intended active section (esp. Our Approach near the
  // bottom of a short page).
  const ignoreSpyUntil = useRef(0);

  // Sliding active-nav indicator. A single element positioned from the active
  // link's measured geometry, animated with a plain CSS transition. (Framer's
  // layoutId shared-layout animation jittered against the sticky sidebar.)
  const navRef = useRef(null);
  const [indicator, setIndicator] = useState(null);

  useEffect(() => {
    const measure = () => {
      const nav = navRef.current;
      if (!nav) return;
      const active = nav.querySelector(`[data-section="${activeSection}"]`);
      if (!active) return;
      setIndicator({ top: active.offsetTop, height: active.offsetHeight });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [activeSection]);

  useEffect(() => {
    const measure = () => {
      const nav = document.querySelector("nav");
      if (nav) setNavHeight(nav.getBoundingClientRect().height);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  useEffect(() => {
    // Smooth hash jumps on this page (global theme.css already enables smooth
    // scroll). The scroll-spy is suppressed for a beat after a click (see
    // ignoreSpyUntil) so it doesn't thrash the sidebar while the animation
    // passes through intermediate sections.
    const sections = NAV_SECTIONS.map((section) => document.getElementById(section.id)).filter(
      Boolean
    );

    const onScroll = () => {
      if (performance.now() < ignoreSpyUntil.current) return;

      // Active section = the one occupying the most of the viewport. This
      // handles short final sections that sit at the bottom of the page (e.g.
      // Our Approach): the old "30%-line + force-last-when-near-bottom" rule
      // snapped the highlight to Our Team as soon as a sidebar click scrolled
      // near max scroll, so Our Approach could never stay lit. On ties the
      // earlier section wins, keeping Overview active at the very top.
      const viewport = window.innerHeight;
      let current = sections[0]?.id;
      let maxVisible = -1;
      for (const el of sections) {
        const rect = el.getBoundingClientRect();
        const visible = Math.min(rect.bottom, viewport) - Math.max(rect.top, 0);
        if (visible > maxVisible) {
          maxVisible = visible;
          current = el.id;
        }
      }

      // The page is short enough that the final section (Our Team) can't scroll
      // to the top, so it never wins "most-visible". Activate it only at the
      // very bottom of the page (2px tolerance) — tight enough that it never
      // steals the highlight from Our Approach mid-scroll.
      const atBottom =
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      if (atBottom) {
        current = sections[sections.length - 1]?.id ?? current;
      }

      if (current) {
        setActiveSection((prev) => (prev === current ? prev : current));
      }
    };

    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  const goToSection = (event, id) => {
    event.preventDefault();
    const el = document.getElementById(id);
    if (!el) return;
    // Suppress scroll-spy while the smooth scroll animates through the
    // intermediate sections so the sidebar highlight doesn't thrash.
    ignoreSpyUntil.current = performance.now() + 900;
    setActiveSection(id);
    // Smooth jump; scroll-margin-top on sections clears the sticky nav.
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    if (history.replaceState) {
      history.replaceState(null, "", `#${id}`);
    } else {
      window.location.hash = id;
    }
  };

  return (
    <div
      className={landing.aboutLayout}
      style={{ "--about-sticky-top": `${navHeight}px` }}
    >
      <aside className={landing.aboutSidebar}>
        <div className={landing.aboutSidebarInner}>
          <div className={landing.aboutSidebarHeader}>
            <h1 className={landing.aboutSidebarTitle}>About Lumen</h1>

            <nav className={landing.aboutNav} aria-label="About sections" ref={navRef}>
              {indicator && (
                <span
                  className={landing.aboutNavIndicator}
                  aria-hidden="true"
                  style={{ top: indicator.top, height: indicator.height }}
                />
              )}
              {NAV_SECTIONS.map((section) => (
                <a
                  key={section.id}
                  data-section={section.id}
                  href={`#${section.id}`}
                  onClick={(event) => goToSection(event, section.id)}
                  className={`${landing.aboutNavLink} ${
                    activeSection === section.id ? landing.aboutNavLinkActive : ""
                  }`}
                >
                  <span className={landing.aboutNavLabel}>{section.label}</span>
                </a>
              ))}
            </nav>
          </div>

          <div className={landing.glanceBlock}>
            <dl className={landing.glanceList}>
              {GLANCE.map((item) => (
                <div key={item.label} className={landing.glanceItem}>
                  <dt className={landing.glanceItemLabel}>{item.label}</dt>
                  <dd className={landing.glanceItemValue}>
                    {item.href ? (
                      <a
                        href={item.href}
                        className={landing.glanceLink}
                        {...(item.href.startsWith("http")
                          ? { target: "_blank", rel: "noopener noreferrer" }
                          : {})}
                      >
                        {item.value}
                      </a>
                    ) : (
                      item.value
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </aside>

      <div className={landing.aboutContent}>
        <section id="overview" className={landing.aboutSection}>
          <h2 className={landing.aboutSectionTitle}>Overview</h2>
          <p className={landing.aboutLead}>{OVERVIEW_LEAD}</p>
          {OVERVIEW_PARAS.map((para, i) => (
            <p
              key={i}
              className={`${landing.aboutText} ${i > 0 ? landing.aboutTextSpaced : ""}`}
            >
              {para}
            </p>
          ))}
          <ol className={landing.stepList}>
            {STEPS.map((step, i) => (
              <li key={step.title} className={landing.stepItem}>
                <span className={landing.stepBody}>
                  <span className={landing.stepTitle}>
                    {i + 1}. {step.title}
                  </span>
                  <span className={landing.stepDesc}>{step.desc}</span>
                </span>
              </li>
            ))}
          </ol>
        </section>

        <hr className={landing.aboutDivider} />

        <section id="how-its-built" className={landing.aboutSection}>
          <h2 className={landing.aboutSectionTitle}>Our Approach</h2>
          <p className={landing.aboutLead}>{APPROACH_LEAD}</p>
          <ol className={landing.stepList}>
            {FEATURES.map((feature, i) => (
              <li key={feature.title} className={landing.stepItem}>
                <span className={landing.stepBody}>
                  <span className={landing.stepTitle}>
                    {i + 1}. {feature.title}
                  </span>
                  <span className={landing.stepDesc}>{feature.desc}</span>
                </span>
              </li>
            ))}
          </ol>
        </section>

        <hr className={landing.aboutDivider} />

        {/* A tool that lists only its strengths is not describing itself. Same
            register as the Method page's privacy note: specifics, not comfort. */}
        <section id="limits" className={landing.aboutSection}>
          <h2 className={landing.aboutSectionTitle}>What It Does Not Do</h2>
          <ul className={landing.aboutLimits}>
            {LIMITS.map((limit, i) => (
              <li key={i} className={landing.aboutLimitItem}>
                {limit}
              </li>
            ))}
          </ul>
        </section>

        <hr className={landing.aboutDivider} />

        <section id="the-team" className={landing.aboutSection}>
          <h2 className={landing.aboutSectionTitle}>Our Team</h2>
          <div className={landing.teamGrid}>
            {TEAM.map((member) => (
              <div
                key={member.name}
                className={landing.teamCard}
                style={member.wide ? { gridColumn: "1 / -1" } : undefined}
              >
                <span className={landing.teamAvatar} aria-hidden>
                  {initials(member.name)}
                </span>
                <span className={landing.teamInfo}>
                  <span className={landing.teamName}>{member.name}</span>
                  <span className={landing.teamRole}>{member.role}</span>
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
