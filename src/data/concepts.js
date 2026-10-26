// How Lumen actually works, one idea per card.
//
// These exist so the Method page can stay short. Method answers "what happens
// and in what order"; anything a teacher might need explained properly lives
// here, where there is room for a definition, a worked example, and an analogy.
// Moving the depth here is what stopped Method from repeating itself.

export const concepts = [
  {
    term: "Verification, and its three states",
    short: "Every check reports pass, warn, or unchecked. The third never becomes the first.",
    definition:
      "Before a draft reaches you, Lumen runs a set of checks over it and reports each one in one of three states: checked and fine, checked and not fine, or not checked at all. The third state exists because some checks cannot run on some drafts. A lesson with no answer key has no answer key to verify. A draft you just rewrote has a reading score that describes the version you replaced. In both cases the honest report is \"not checked\", and folding that into \"fine\" would make every green tick meaningless.",
    example:
      "You generate a discussion-based lesson with no numeric questions. The Timing row says checked and fine, 50 minutes against a 50 minute period. The Answer key row says not checked, because there is no key. It does not say fine.",
    analogy:
      "A pre-flight checklist where one item is \"landing gear: not inspected\". That is not the same as \"landing gear: fine\", and a checklist that quietly rounded the first into the second would be worse than no checklist, because you would stop reading it.",
    inProduct:
      "The row of checks at the top of every draft, and the flags in the section margins.",
  },
  {
    term: "Hallucination",
    short: "A model stating something false with the same fluency it states something true.",
    definition:
      "Language models generate text that is likely, not text that is true. When the likely next words happen to be false, the output is confident anyway, because confidence is a property of the writing rather than of the knowledge behind it. No set of instructions makes a model incapable of this, which is why Lumen never claims it does not happen. What Lumen does instead is narrower: take claims out of the model's hands wherever the answer can be computed, recompute the ones that can be recomputed, and label the rest as the model's word.",
    example:
      "Asked for a standards code, a model will happily produce \"HS-PS1-9\" in the correct format. It reads exactly like a real code. There is no such standard. Lumen never asks the model to recall a code for this reason; it gives the model a list and checks what comes back against that same list.",
    analogy:
      "A fluent speaker of a language you do not know, giving you directions with total confidence. Nothing in their tone tells you whether they know the city. You need a map, and the map is the part Lumen supplies.",
    inProduct:
      "The whole verification layer, and the checked-versus-not table on the Method page.",
  },
  {
    term: "Retrieval, then validation",
    short: "The model picks from a list it was given, and the pick is checked against that list.",
    definition:
      "Rather than asking the model what standard fits, Lumen looks up candidate standards in a local dataset by subject and grade, sends that list along with the request, and asks the model to select from it. When the response comes back, every code is checked against the same dataset a second time in code. A code that is not in the dataset is dropped and counted. This makes an invented standard not merely unlikely but unexpressible: there is nowhere for it to survive.",
    example:
      "You ask for a grade 9 biology lesson on cells. Lumen retrieves the NGSS life-science standards for that band, the model selects two, and both are confirmed against the dataset before you see them. If the model had returned a third code that was not on the list, it would have been removed and the count of rejected codes would read 1.",
    analogy:
      "A multiple-choice question instead of a fill-in-the-blank, with the answers marked against the key afterwards. You cannot write in an option that was never on the page.",
    inProduct:
      "The standards on every draft, and the dataset size published on the Method page.",
  },
  {
    term: "Blind re-solve",
    short: "Answer keys are solved a second time by a model that is never shown the first answer.",
    definition:
      "A model shown a proposed answer tends to agree with it, so asking \"is this right?\" is close to worthless. Lumen instead sends the questions alone to a separate call at temperature zero, with the proposed answers withheld, and compares the two results. Where they disagree, both are shown side by side and nothing is silently corrected, because the tool has no basis for deciding which one is right. Arithmetic inside a worked solution is not asked about at all: it is evaluated in code by a calculator that only does arithmetic.",
    example:
      "The draft's key says a 14 percent tip on $62.50 is $8.05. The second pass, never having seen that, returns $8.75. You see both, flagged, and settle it yourself in about three seconds. Without the second pass you would have photocopied $8.05.",
    analogy:
      "Two accountants closing the same books in separate rooms. If you show the second one the first one's totals, you have not bought a second opinion. You have bought agreement.",
    inProduct:
      "The Answer key row on a draft, and the side-by-side disagreements in the key itself.",
  },
  {
    term: "Reading level",
    short: "Flesch-Kincaid grade level, measured on student-facing text only.",
    definition:
      "Lumen measures the grade level of the text students actually receive, using the Flesch-Kincaid formula on sentence length and syllable counts. Teacher notes, answer keys, and the teacher half of every procedure step are excluded, because prose written for an adult would drag the score up and make an accessible handout look inaccessible. If the score lands outside the band you asked for, Lumen asks once more for that specific change and keeps the second draft only if it is genuinely closer.",
    example:
      "You ask for below-grade reading for a grade 9 biology lesson. The first draft measures 9.4, outside the 4 to 8 band. Lumen asks again, naming the number, and the second draft measures 5.4 and is kept. Had it come back at 11, the first draft would have been kept instead.",
    analogy:
      "A kitchen thermometer, not a chef. It tells you the roast is at 55 degrees. It has no opinion about whether the meal is any good, and it cannot taste the seasoning.",
    inProduct:
      "The Reading level row on a draft, and the reading-level control on the planning sheet.",
  },
  {
    term: "Blanks to fill",
    short: "Bracketed placeholders marking where your own local, current data belongs.",
    definition:
      "Lumen cannot look anything up. It has no search tool and no document library, so where a lesson needs a real current figure, it leaves a marked blank rather than inventing a number that would look authoritative and be wrong. The blanks are counted and reported on every draft. Placeholders are the honest behaviour; the failure mode is not having them, it is walking to the copier without filling them in.",
    example:
      "A lesson on urban heat islands contains \"[insert current data: average July temperature for your neighbourhood]\". Lumen does not know your July. The alternative would have been a confident, fabricated number in a handout going to thirty students.",
    analogy:
      "A form with a blank marked \"today's date\" rather than a date already printed on it. The blank is the form being honest about what it cannot know when it was printed.",
    inProduct:
      "The Blanks to fill row on a draft, and the highlighted placeholders in the text.",
  },
  {
    term: "Student copy and teacher copy",
    short: "Every section is marked for one audience, and the student copy omits the rest.",
    definition:
      "Each section of a draft carries an audience: student, teacher, or both. The student copy renders only what students should see; the teacher copy renders everything. When the audience is missing, Lumen reads the structure to decide, and where it cannot tell, it falls back to teacher, because the one direction that must never happen is an answer key landing on a student handout. If that fallback leaves the student copy empty, Lumen says so on the page rather than letting you print blank paper.",
    example:
      "A quiz has a Questions section marked student and a Scoring notes section marked teacher. Print the student copy and the scoring notes are gone. Print the teacher copy and both are there, with the teacher-only parts marked.",
    analogy:
      "A script with stage directions. The audience sees the play; the cast sees the play plus everything in brackets. Printing the wrong version does not just add clutter, it gives away the ending.",
    inProduct:
      "The Teacher copy and Student copy toggle above every draft, and the export and print options.",
  },
  {
    term: "Timing reconciliation",
    short: "Section minutes are added up and compared against your period, then re-asked once.",
    definition:
      "Every section carries a number of minutes. Lumen adds them and compares the total to the period length you entered. If they miss by more than two minutes, it asks the model again and tells it the measured difference, which works where repeating the original constraint does not, because the model already believes it complied. The second answer is kept only if it is closer than the first. The sum is then recomputed in your browser every time you open the draft, so editing a section cannot leave a stale total behind.",
    example:
      "You set a 50 minute period. The first draft's sections add to 45. Lumen asks again, naming the missing 5 minutes, and the revision comes back at exactly 50. It also warns separately if an exit ticket pushes the real total past the bell.",
    analogy:
      "Adding a receipt yourself instead of trusting the printed total. The arithmetic takes a moment, and it is the only part of the bill nobody can argue with.",
    inProduct:
      "The Timing row on a draft, and the minutes shown beside each section heading.",
  },
  {
    term: "Grouping and copy counts",
    short: "Group arithmetic and print runs are checked against your actual class size.",
    definition:
      "When a draft proposes groups, Lumen checks that the number of groups times the group size, plus any remainder, equals the class size you entered. It checks print counts against the same number. A mismatch is marked disputed on the draft rather than quietly adjusted, because the tool does not know whether you meant to print spares.",
    example:
      "You entered 29 students. The draft proposes 7 groups of 4, which accounts for 28, and asks for 25 copies. Both are flagged: one student has no group, and four students have no handout.",
    analogy:
      "Counting chairs before the guests arrive. Nobody notices the count was right. Everybody notices when it was not.",
    inProduct:
      "The grouping block on a draft, and the print counts in the materials list.",
  },
  {
    term: "Prompt version",
    short: "The stamp identifying which set of instructions produced a given draft.",
    definition:
      "Lumen's instructions to the model change as the tool improves. Every draft records the version of those instructions that produced it. This is what makes a bad result reproducible later: without it, a report of \"the lesson was wrong\" cannot be tied to the behaviour that caused it, and a fix cannot be confirmed.",
    example:
      "You flag a section as wrong in March. The report records prompt version 2026-08-23.1. When that rule is changed in April, the same inputs can be run again to confirm the problem is actually gone rather than merely absent this time.",
    analogy:
      "The lot number on a medicine bottle. It matters only when something goes wrong, and then it is the only thing that matters.",
    inProduct:
      "Shown on the Method page for your most recent draft, and recorded with every section report.",
  },
  {
    term: "Rubric",
    short: "Named criteria with described levels, for grading work that has no single right answer.",
    definition:
      "An answer key settles a numeric question. It cannot settle whether an explanation is clear or a model is well argued. A rubric names the criteria being judged and describes what each level of performance looks like, so the standard is fixed before the marking starts and can be shown to students in advance. Lumen builds rubrics as structured criteria and levels rather than prose, so they render and print as a table and cannot drift out of shape on export.",
    example:
      "A project assessment carries the criterion \"Accuracy of model\" with three described levels: all values correct and units consistent; minor unit errors; major errors in setup. The same table prints for you and, if you choose, for students before they start.",
    analogy:
      "The scoring sheet a diving judge holds, not the stopwatch at a race. The stopwatch needs no agreement. The scoring sheet is what keeps three judges honest with each other.",
    inProduct:
      "The rubric block on assessment drafts, teacher-facing, and included in exports.",
  },
  {
    term: "Differentiated versions",
    short: "A separate, separately editable draft of the same lesson at another level.",
    definition:
      "A draft's differentiation block describes what to change for students working below or above grade level, but description is not something you can hand out. Lumen can turn that description into a real second draft, filed in the same class and unit as the original and titled to match. It is a new material rather than a field on the old one, so you can edit, print, and refile it independently, and the original is untouched.",
    example:
      "From a grade 9 linear-equations lesson you make a below-grade version. It lands beside the original in Unit 1 as \"Linear equations (below grade)\", with sentence frames added and the same objective. You edit that copy freely; the original stays as it was.",
    analogy:
      "A translation published as its own book rather than a footnote in the original. Both sit on the shelf. Neither is a marginal note on the other.",
    inProduct:
      "The File menu on a draft, under Make a below-grade version and Make an above-grade version.",
  },
];
