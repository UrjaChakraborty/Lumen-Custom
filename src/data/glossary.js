// Shared glossary of key terms, used by the in-app reference.

export const glossary = [
  {
    term: "CRP: Culturally Responsive Pedagogy",
    short: "Teaching that connects to students' cultures, languages, and communities.",
    definition:
      "An approach developed by Geneva Gay and Gloria Ladson-Billings that treats students' cultural knowledge, prior experience, and community assets as the material you teach rigorous content with, rather than decoration applied afterwards. It rests on three commitments that have to travel together: high academic expectations for every student, cultural competence so students keep a footing in their own community while succeeding in school, and a critical consciousness that lets them question how the world is arranged. Dropping any one of the three is the common failure. Keeping only the first is a deficit model with warm language; keeping only the second produces a heritage display with no rigour behind it.",
    inProduct:
      "It drives the Cultural & Community Anchors inputs and the Cultural/Community Connection section that every generated lesson has to include.",
    example:
      "A ninth-grade class in Little Village studies exponential growth using the actual resale prices of quinceanera dresses in the neighborhood, tracked over five years. The mathematics is the standard exponential-decay curve. The data is theirs, and several students already know why the second-year price drops hardest.",
    analogy:
      "It is the difference between a passport and a visa. A visa lets you visit, and you are still a guest the whole time. A passport says the place is already yours. CRP treats a student's culture as the passport into the content, not a visa the content grants them.",
  },
  {
    term: "CSP: Culturally Sustaining Pedagogy",
    short: "Actively sustaining students' cultural and linguistic practices.",
    definition:
      "Django Paris and H. Samy Alim's extension of culturally responsive pedagogy, and a deliberate sharpening of it. Responding to a student's culture still leaves school as the fixed point that the student is being helped to reach. Sustaining asks school to actively keep the languages, literacies, and cultural practices of a community alive, and to resist the pressure toward assimilation that ordinary schooling applies whether anyone intends it or not. It also insists these practices are living rather than preserved: young people remix and change what they inherit, and a version of the culture frozen at the grandparents' generation is not the one in the room.",
    inProduct:
      "It shapes prompt language so home languages and cultural practices are treated as resources to build on, never as something to correct.",
    example:
      "A student writes a lab conclusion that moves between English and Spanish because the precise word for what she observed came to her in Spanish first. Under CSP the teacher marks the reasoning, and the bilingual draft stays a draft feature rather than an error to be corrected out.",
    analogy:
      "A garden, not a lawn. A lawn is kept uniform by cutting whatever grows differently. A garden is tended so each thing keeps growing as what it is. CSP tends rather than mows.",
  },
  {
    term: "UDL: Universal Design for Learning",
    short: "Designing flexible options so all learners can access and show learning.",
    definition:
      "A framework from CAST built on the finding that variability among learners is the norm rather than the exception, so a lesson designed for an average student is designed for nobody in particular. It organises design around three questions: engagement, the why of learning, meaning how interest and persistence are sustained; representation, the what, meaning how information is presented; and action and expression, the how, meaning the ways a student can show what they know. Each has checkpoints underneath it. The defining move is that the options are built in at design time for everyone, rather than retrofitted as accommodations for particular students after the fact, which is both cheaper and less stigmatising.",
    inProduct:
      "It maps to the Accessibility Supports inputs and to the rule that every output offers more than one way to take in the content and show learning.",
    example:
      "The same photosynthesis lesson offers a labelled diagram, a two-minute narrated clip, and a written passage. Students may show what they learned by drawing the cycle, explaining it aloud, or writing it. Nobody had to request any of these.",
    analogy:
      "Curb cuts in a sidewalk. They were built for wheelchairs, and they are used by strollers, delivery carts, and anyone pulling a suitcase. Designing the ramp in from the start costs less than cutting the concrete later, and more people cross.",
  },
  {
    term: "Differentiation",
    short: "Adjusting content, process, or product to varied learner readiness.",
    definition:
      "Carol Ann Tomlinson's practice of varying the content students work with, the process they use, the product they make, or the environment they work in, according to their readiness, interest, and learning profile, while the learning goal itself stays the same for everyone. That last clause is what separates it from tracking: differentiation changes the route, not the destination, and it is temporary and responsive rather than a fixed assignment to a level. It also is not individualisation. Thirty separate lesson plans is not the goal and is not sustainable; a small number of deliberate, well-chosen options usually is.",
    inProduct:
      "It powers the Differentiation Options controls and the revision actions like make more accessible, low-tech, and multilingual.",
    example:
      "One class works the same slope problem three ways: some get the table filled in and find the pattern, some get raw data to organise themselves, and some are asked to prove why the rate stays constant. Everyone leaves able to find a rate of change.",
    analogy:
      "A staircase and a ramp to the same door. The building has one entrance and everyone arrives at it. What changes is the route, not the destination.",
  },
  {
    term: "Accessibility",
    short: "Removing barriers so content works for the widest range of learners.",
    definition:
      "Designing materials so they work for students with disabilities, with varied reading levels, with different language backgrounds, and with limited or no technology at home, including settings where the only reliable delivery is paper. In practice this covers legal obligations under IDEA and Section 504, and also a wider set of ordinary constraints that no plan documents: a cracked phone screen, a shared laptop, a noisy house, an intermittent connection. It overlaps with UDL but is not identical to it. UDL is the design philosophy; accessibility is the concrete property a finished material either has or does not have, and it can be checked.",
    inProduct:
      "Reading-level, language, neurodiverse, and low-tech toggles that apply across all generators.",
    example:
      "A lesson written for a class with one student on an IEP for reading, four newcomers, and no reliable wifi at home: the reading is at grade six rather than grade nine, key terms carry Spanish cognates, and the homework works on paper.",
    analogy:
      "A door wide enough for everyone. You do not ask who is coming through before deciding how wide to build it.",
  },
  {
    term: "Formative Assessment",
    short: "Low-stakes checks used to adjust teaching in the moment.",
    definition:
      "Assessment for learning rather than of it: low-stakes checks such as exit tickets, quick polls, whiteboard responses, and structured observation, whose purpose is to produce information that changes what happens next. The distinguishing feature is not the format or the low stakes but the response. A quiz that is collected, graded, and returned without altering the following lesson is summative regardless of what it is called. Formative work is usually ungraded precisely so that students report what they do not yet understand instead of concealing it, which is the only way the information is worth having.",
    inProduct:
      "The Check for Understanding lesson section and the exit-ticket and quiz templates in the Assessment module.",
    example:
      "Two minutes before the bell, students write the one step in the titration they would get wrong if they did it alone. The teacher reads the twenty-nine answers that night and reteaches one step tomorrow, rather than discovering the problem on the unit test.",
    analogy:
      "Tasting the soup while you cook it. The grade at the end is the diner's review. Tasting is what lets you still fix the salt.",
  },
  {
    term: "Culturally Relevant Examples",
    short: "Problems and contexts drawn from students' real communities.",
    definition:
      "Problems and contexts drawn from the specific places students actually live: neighbourhood data, local industries, transit they use, issues their families are arguing about. The purpose is not motivation alone. A familiar context gives students existing knowledge to reason from, so an abstract relationship has somewhere to attach. The critical constraint is specificity. An example built on a real block, a real bus line, or a real local dispute does this work. An example built on an assumed group trait does the opposite: it substitutes a stereotype for knowledge of the students, and students notice immediately.",
    inProduct:
      "Generated hooks and problem contexts pull from the teacher's Community context and Student interests fields.",
    example:
      "Instead of a generic word problem about a train, students model the wait times at the bus stop two blocks from school, using the posted schedule and the times they actually recorded that week.",
    analogy:
      "Cooking with what is in the kitchen. The recipe does not change, and the meal is not worse for using what is already on the shelf. It is faster, and it tastes like home.",
  },
  {
    term: "Asset-Based Feedback",
    short: "Feedback that names strengths and growth without deficit language.",
    definition:
      "Feedback framed around what a student can already do and what the single next step is, rather than around what is absent. It is a discipline about language as much as about content: deficit terms such as struggling, low, lacking, or behind position the student or their community as the problem, and they migrate quickly from a comment on one piece of work into a description of a person. Asset-based feedback stays specific and behavioural, names the actual move that worked, and gives one actionable next step. It is not praise, and it is not withholding criticism. It is criticism aimed at the work.",
    inProduct:
      "The Feedback Assistant's strengths-based and growth-oriented templates, plus the deficit-language flag in the review checklist.",
    example:
      "\"You set up the proportion correctly and your units are consistent. The next step is checking whether the answer is reasonable before you box it.\" Not: \"You are still struggling with proportions.\"",
    analogy:
      "A coach reviewing game film rather than a judge reading a verdict. Both watch the same play. One of them is describing what to do on the next one.",
  },
  {
    term: "PBL: Project-Based Learning",
    short: "Learning through sustained, authentic projects.",
    definition:
      "Students build knowledge by working over an extended period on a genuine, often community-connected problem that ends in a product presented to a real audience. The features that make it work are a driving question with no predetermined answer, sustained inquiry over weeks rather than a single lesson, student voice in how the work proceeds, iteration on the basis of critique, and a public product. It is frequently confused with doing a project at the end of a unit, which is the inverse: there the content is taught first and the project decorates it, while in PBL the project is the vehicle through which the content is learned.",
    inProduct:
      "The Activity/PBL generator and the Add project-based activity revision action.",
    example:
      "Over six weeks students measure surface temperatures on their own block, map the shade gaps, and present a tree-planting proposal to the ward office. The heat-island content is the same content. The audience is real.",
    analogy:
      "Learning to cook by making dinner for people who are actually hungry, rather than by being quizzed on recipes. The stakes do the teaching.",
  },
  {
    term: "Constructivism",
    short: "Learners build understanding on prior knowledge and experience.",
    definition:
      "A theory of learning associated with Piaget and Vygotsky holding that people do not receive knowledge intact but build it by connecting new information to what they already know, and through interaction with others. Piaget's contribution is the individual mechanism: existing mental structures either absorb new information or are forced to reorganise around it. Vygotsky's is the social one: the distance between what a learner can do alone and what they can do with support is where instruction should aim, and language is the tool that moves the boundary. This is the reason Lumen anchors an unfamiliar STEM idea in a familiar context before naming it: there has to be an existing structure for the new idea to attach to.",
    inProduct:
      "It justifies the anchor-first, abstract-second structure of the lesson hook and main activity.",
    example:
      "Before introducing the term \"buffer\", the teacher asks why adding lemon to tea changes the taste less than you would expect. Students reason from something they have tasted, and the chemistry lands on a shelf that already exists.",
    analogy:
      "Building on a foundation instead of on bare ground. New understanding has to be bolted to something already standing, or it will not hold weight.",
  },
  {
    term: "Responsible GenAI Use",
    short: "Human-in-the-loop, privacy-aware, bias-checked AI use in schools.",
    definition:
      "Using generative AI as a drafting assistant whose output a human being always reviews for accuracy, bias, and fit before it reaches students. Concretely it means several things at once: never entering personally identifying student information into a system you do not control; treating every factual claim as unverified until checked; knowing which parts of a tool's output were computed and which were merely generated; and being able to say plainly to a colleague, a parent, or a union representative what was sent where. It is not a claim that the model is trustworthy. It is an arrangement that stays safe when the model is not.",
    inProduct:
      "Guardrail banners, the Review for Bias & Fit step, and the no-PII warning throughout the dashboard.",
    example:
      "A teacher drafts a quiz in Lumen, spots that question four assumes students have seen a titration curve before, rewrites it, and checks the answer key by hand. The draft saved forty minutes. The judgement was still theirs.",
    analogy:
      "A power tool, not an autopilot. A saw cuts faster than a hand blade and it still needs someone holding it who knows where the line goes.",
  },
];
