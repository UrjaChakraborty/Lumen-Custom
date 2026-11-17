import React from "react";
import { motion } from "framer-motion";
import Icon from "../components/Icon.jsx";
import landing from "../styles/Landing.module.css";

const MODULES = [
  { icon: "book", label: "Lesson Plan", route: "generate" },
  { icon: "puzzle", label: "Activity / PBL", route: "generate" },
  { icon: "clipboard", label: "Assessment", route: "generate" },
  { icon: "message", label: "Feedback", route: "feedback" },
];

const gridVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.06, delayChildren: 0.28 } },
};

// Waterfall entrance: headline → search bar → cards → about, guiding the eye
// down the page. `custom` is the step's start delay (seconds).
const enter = {
  hidden: { opacity: 0, y: 14 },
  visible: (delay = 0) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1], delay },
  }),
};
const gridItemVariant = {
  hidden: { opacity: 0, y: 14 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.38, ease: [0.22, 1, 0.36, 1] },
  },
};

export default function Landing({ go }) {
  return (
    <div className={landing.pageWrapper}>
      <div className={landing.pageContent}>
        <section className={landing.hero}>
          <motion.p
            className={landing.heroHeading}
            variants={enter}
            custom={0.05}
            initial="hidden"
            animate="visible"
          >
            Build culturally responsive STEM materials
            <span className={landing.heroAccent}>in plain language</span>
          </motion.p>
        </section>

        <div className={landing.homeActions}>
          <motion.div
            className={landing.homeSearchWrap}
            variants={enter}
            custom={0.15}
            initial="hidden"
            animate="visible"
          >
            <div className={landing.searchRow}>
              <span className={landing.searchIcon}>
                {/* The control opens the builder to start writing, so the icon says
                      that. A sparkle says "AI happened here", which is decoration
                      standing in for a description. */}
                  <Icon name="pencil" size="sm" />
              </span>
              <button
                type="button"
                className={landing.searchInput}
                style={{ textAlign: "left", cursor: "pointer" }}
                onClick={() => go("generate")}
              >
                Open the Resource Builder to start a draft…
              </button>
              <button
                type="button"
                className={landing.searchSubmitBtn}
                onClick={() => go("generate")}
              >
                Start
              </button>
            </div>
          </motion.div>

          <section className={landing.quickstart}>
            <div className={landing.quickstartHeader}>
              <h2 className={landing.quickstartTitle}>Resource Builder</h2>
              <button
                type="button"
                className={landing.allMetricsLink}
                onClick={() => go("generate")}
              >
                Open Builder{" "}
                <span className={landing.linkArrow} aria-hidden="true">
                  →
                </span>
              </button>
            </div>
            <motion.div
              className={landing.metricGrid}
              variants={gridVariants}
              initial="hidden"
              animate="visible"
            >
              {MODULES.map((m) => (
                <motion.button
                  key={m.label}
                  type="button"
                  className={landing.metricCard}
                  variants={gridItemVariant}
                  onClick={() => go(m.route)}
                >
                  <span className={landing.metricCardFace}>
                    <span className={landing.metricCardIcon}>
                      <Icon name={m.icon} />
                    </span>
                    <span className={landing.metricCardLabel}>{m.label}</span>
                  </span>
                </motion.button>
              ))}
            </motion.div>
          </section>

          <motion.section
            className={landing.aboutCard}
            variants={enter}
            custom={0.4}
            initial="hidden"
            animate="visible"
          >
            <h2 className={landing.aboutCardTitle}>About the Method</h2>
            <p className={landing.aboutSectionText}>
              Lumen drafts STEM materials from culturally responsive pedagogy, culturally sustaining
              pedagogy, and universal design for learning. Cultural context and accessibility
              supports are built into the workflow.
            </p>
            <button type="button" className={landing.learnMoreLink} onClick={() => go("learn")}>
              Learn more{" "}
              <span className={landing.linkArrow} aria-hidden="true">
                →
              </span>
            </button>
          </motion.section>
        </div>
      </div>
    </div>
  );
}
