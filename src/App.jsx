import React, { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { ToastProvider, useRevealOnScroll } from "./components/ui.jsx";
import SiteLayout from "./components/SiteLayout.jsx";
import Landing from "./pages/Landing.jsx";
import Generate from "./pages/Generate.jsx";
import About from "./pages/About.jsx";
import Learn from "./pages/Learn.jsx";
import Classes from "./pages/Classes.jsx";
import Materials from "./pages/Materials.jsx";
import Feedback from "./pages/Feedback.jsx";
import { defaultInput } from "./data/inputSchema.js";
import {
  loadClasses,
  saveClasses,
  loadActiveClassId,
  saveActiveClassId,
} from "./data/classes.js";
import { loadMaterials, saveMaterials } from "./data/materials.js";

// URL paths for each route. Home stays at the root URL; the others get clean
// paths so they're linkable and survive refresh (Vite's SPA fallback serves
// index.html for these).
const ROUTE_TO_PATH = {
  landing: "/",
  generate: "/builder",
  about: "/about",
  learn: "/method",
  classes: "/classes",
  materials: "/materials",
  feedback: "/feedback",
};
const PATH_TO_ROUTE = {
  "/": "landing",
  "/builder": "generate",
  "/about": "about",
  "/method": "learn",
  "/classes": "classes",
  "/materials": "materials",
  "/feedback": "feedback",
};

function routeFromLocation() {
  return PATH_TO_ROUTE[window.location.pathname] || "landing";
}

export default function App() {
  const [route, setRoute] = useState(routeFromLocation);
  const [input, setInput] = useState(defaultInput);
  const firstRender = useRef(true);

  // A teacher's sections, saved once and reused all year. Held here because both
  // the nav (the switcher) and the builder (prefill) need them.
  //
  // Both setters take a value or an updater, and both return whether the write
  // to localStorage actually landed.
  //
  // The updater form is what makes undo correct. Restoring by replacing the
  // whole list with a snapshot taken before the delete would also revert
  // anything the teacher did in between — duplicate a lesson, then undo a
  // delete, and the duplicate vanishes. Splicing the one removed item back into
  // whatever the list is *now* cannot do that. The refs mirror state so several
  // updates in the same tick each see the previous one.
  //
  // The boolean matters because saveClasses/saveMaterials return false when
  // localStorage rejects the write, and that was being dropped: hitting the
  // storage quota looked exactly like saving successfully.
  const [classes, setClassesState] = useState(loadClasses);
  const [activeClassId, setActiveClassIdState] = useState(loadActiveClassId);
  const classesRef = useRef(classes);
  classesRef.current = classes;
  const setClasses = (next) => {
    const value = typeof next === "function" ? next(classesRef.current) : next;
    classesRef.current = value;
    setClassesState(value);
    return saveClasses(value);
  };
  const setActiveClassId = (id) => {
    setActiveClassIdState(id);
    saveActiveClassId(id);
  };

  // If the stored active id points at a class that no longer exists, fall back
  // to the first one.
  useEffect(() => {
    if (activeClassId && !classes.some((c) => c.id === activeClassId)) {
      setActiveClassId(classes[0]?.id || null);
    }
  }, [classes, activeClassId]);

  const activeClass = classes.find((c) => c.id === activeClassId) || null;

  // Saved drafts, so generated work does not vanish when the tab closes.
  const [materials, setMaterialsState] = useState(loadMaterials);
  const materialsRef = useRef(materials);
  materialsRef.current = materials;
  const setMaterials = (next) => {
    const value = typeof next === "function" ? next(materialsRef.current) : next;
    materialsRef.current = value;
    setMaterialsState(value);
    return saveMaterials(value);
  };

  // Opening a saved draft hands it to the builder, which jumps to results.
  const [openMaterial, setOpenMaterial] = useState(null);
  const [feedbackPlan, setFeedbackPlan] = useState(null);
  const openInBuilder = (item) => {
    setOpenMaterial(item);
    setInput({ ...defaultInput, ...(item.input || {}) });
    go("generate");
  };
  const reviewLessonPlan = (plan) => {
    setFeedbackPlan(plan);
    go("feedback");
  };

  useRevealOnScroll(route);

  const go = (id) => {
    setRoute(id);
    const path = ROUTE_TO_PATH[id] || "/";
    if (window.location.pathname !== path) {
      window.history.pushState({ route: id }, "", path);
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Keep route in sync with browser back/forward navigation.
  useEffect(() => {
    const onPop = () => setRoute(routeFromLocation());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    document.getElementById("main")?.focus?.({ preventScroll: true });
  }, [route]);

  return (
    <ToastProvider>
      <a className="skip-link" href="#main">
        Skip to main content
      </a>
      <SiteLayout route={route} go={go}>
        {/* Keyed fade-in on mount. We intentionally do NOT use AnimatePresence
            with an exit here: `mode="wait"` could deadlock (the exiting page's
            exit never resolving, so the next page never mounts — a blank screen)
            when navigating away from a scrolled page. A pure fade-in of the new
            page is a clean cross-fade that can never get stuck. */}
        <motion.div
          key={route}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.18, ease: "easeInOut" }}
        >
          {route === "landing" && <Landing go={go} />}
          {route === "generate" && (
            <Generate
              input={input}
              setInput={setInput}
              activeClass={activeClass}
              classes={classes}
              go={go}
              materials={materials}
              setMaterials={setMaterials}
              openMaterial={openMaterial}
              onConsumeOpenMaterial={() => setOpenMaterial(null)}
              onReviewPlan={reviewLessonPlan}
            />
          )}
          {route === "feedback" && (
            <Feedback
              initialPlan={feedbackPlan}
              onConsumeInitialPlan={() => setFeedbackPlan(null)}
            />
          )}
          {route === "about" && <About />}
          {route === "learn" && (
            <Learn
              classes={classes}
              setClasses={setClasses}
              materials={materials}
              setMaterials={setMaterials}
            />
          )}
          {route === "materials" && (
            <Materials
              materials={materials}
              setMaterials={setMaterials}
              classes={classes}
              activeClassId={activeClassId}
              onOpen={openInBuilder}
              go={go}
            />
          )}
          {route === "classes" && (
            <Classes
              classes={classes}
              setClasses={setClasses}
              materials={materials}
              activeId={activeClassId}
              setActiveId={setActiveClassId}
              go={go}
            />
          )}
        </motion.div>
      </SiteLayout>
    </ToastProvider>
  );
}
