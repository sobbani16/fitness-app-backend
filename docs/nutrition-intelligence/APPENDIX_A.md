# APPENDIX A — EXACT ORIGINAL 120-SCENARIO SOURCE (PRODUCT OWNER MATERIAL)

The following original supplied discussion and all its scenario tables are preserved as-is. Where its exploratory language conflicts with an explicit firm product requirement above (e.g., a prior provisional score proposal), follow the firm requirement and record the decision; where numbers remain proposed, escalate for versioned approval before public release.

# **Humai Fitness — Comprehensive Nutrition, Goal & Wellness Scenario Library**

I would expand our original six scenarios into a much broader test library before asking Devin to build the final rules engine.

Rather than focusing only on calories, macros, and exercise, I would examine Humai the way a nutrition-care team would examine a real person's progress: **What is the user's goal? Are their nutritional needs being met? Is their plan sustainable? Are symptoms or medical constraints changing what is appropriate? And are the measurements trustworthy?**

I reviewed major public guidance from the Academy of Nutrition and Dietetics, NIH/NIDDK, USDA/HHS, the American Diabetes Association, ACSM, the International Society of Sports Nutrition, and other clinical sources. I cannot claim to have reviewed every nutrition textbook or every patient presentation, but these provide a strong evidence base for building a systematic scenario library. The Academy's Nutrition Care Process emphasizes assessment, nutrition intervention, and ongoing monitoring—not just a score.&#x20;

eatrightpro.org+4



**My recommendation: Build a master library of 120 scenarios, grouped into 12 domains, with rules that apply across Humai's six primary goals.** These are proposed product test cases, not 120 independently validated clinical protocols.

## **The architecture I would use**

1\. User eligibility & safety

Is standard goal-based coaching appropriate?

2\. One active goal

Weight loss · Fat loss · Muscle gain · Weight gain · Bulking · Maintenance

3\. Nutrition assessment

Calories · Macros · Micronutrients · Food patterns · Meal context

4\. Movement & recovery

Training plan · Activity · Sleep · Symptoms

5\. Deterministic scoring

Recorded progress · Data confidence · Reasons for missing points

6\. Goal outcome monitoring

Weight trends · Strength · Body measurements · Sustainability

7\. Guidance & professional review

Approved suggestions · Safety escalation · Audit history

The order matters. **Safety comes before goal optimization, and goal optimization comes before calculating points.** If a user's situation makes a generic calorie target inappropriate, Humai should not award or deduct points against that target.

## **The 120 scenarios Humai should support**

Priority: P0 = essential safety/correctness, P1 = core release, P2 = advanced functionality. The priority applies to implementation and validation, not the severity of a person's symptoms.

### **A. Goal selection and energy balance — 10 cases**

These determine whether a user's calorie plan actually supports their chosen goal. The NIH Body Weight Planner provides a useful reference for personalized energy planning, while sports-nutrition guidance emphasizes that body composition, adequate protein, and resistance training matter alongside overall energy balance.&#x20;

NIDDK+2



| ID  | Scenario                                                    | Expected Humai behavior                                                                           | Priority |
| --- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | -------- |
| A01 | Weight-loss user consistently exceeds planned calories      | Show intake difference, possible effect on intended deficit, and weekly trend                     | P0       |
| A02 | Weight-loss user eats far too little                        | Do not award a perfect energy score; assess suitability and potential restriction concerns        | P0       |
| A03 | User exceeds calories primarily through protein             | Count all calories; recognize protein adequacy separately                                         | P1       |
| A04 | Muscle-gain user eats below energy needs                    | Explain inadequate energy may hinder training and growth                                          | P1       |
| A05 | Weight-gain user is afraid of eating above maintenance      | Explain why an appropriate surplus may be part of the agreed goal                                 | P1       |
| A06 | Bulking user consumes an excessive surplus                  | Avoid rewarding unlimited intake; show potential unnecessary fat-gain risk                        | P1       |
| A07 | Maintenance user gradually gains or loses weight            | Review trend and reassess estimated needs                                                         | P1       |
| A08 | Fat-loss user loses scale weight but strength also declines | Review training, protein, energy intake and recovery without assuming the cause                   | P1       |
| A09 | Weight stays unchanged despite recorded plan adherence      | Evaluate multiple-week trends, logging confidence, activity assumptions and ordinary fluctuations | P1       |
| A10 | User changes from weight loss to muscle gain                | Require confirmation; preserve old goal, targets and score history; activate one new primary goal | P0       |

**Important refinement:** I would distinguish general weight loss from fat loss, and weight gain from muscle gain, in the goal definitions. Their targets can overlap but they are not interchangeable.

### **B. Macronutrients and nutrient distribution — 10 cases**

Protein, fat and carbohydrate calculations cannot all use the same closeness-to-target formula.

| ID  | Scenario                                                         | Expected Humai behavior                                                                     | Priority |
| --- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | -------- |
| B01 | Protein significantly below target                               | Show recorded shortfall and appropriate food options                                        | P0       |
| B02 | Protein moderately above target                                  | Cap protein credit; count extra calories; don't automatically classify excess as harmful    | P1       |
| B03 | Very high protein combined with a kidney-related restriction     | Apply an authorized individual restriction; require appropriate professional oversight      | P0       |
| B04 | Carbohydrates above a target but calories appropriate            | Evaluate dietary quality and context; no automatic "carbs are bad" warning                  | P0       |
| B05 | Very low carbohydrate intake during demanding endurance training | Assess fueling suitability and possible symptoms                                            | P1       |
| B06 | Fat intake extremely low over multiple days                      | Assess adequacy rather than rewarding fat avoidance                                         | P1       |
| B07 | Fat intake high but mainly unsaturated                           | Assess total energy and fat composition separately                                          | P1       |
| B08 | High-fat, low-carb diet deliberately selected                    | Evaluate individual suitability, nutritional adequacy and any medical constraints           | P2       |
| B09 | User reaches protein goal entirely through supplements           | Award verified protein contribution, but separately assess dietary variety and food quality | P1       |
| B10 | User meets all macro targets but has poor diet quality           | Do not award maximum overall nutrition credit                                               | P0       |

Protein needs are individualized; sports-nutrition evidence supports different requirements according to training and energy restriction.&#x20;

pmc.ncbi.nlm.nih.gov+1



### **C. Sugar, oils, processed foods and food quality — 10 cases**

These should power **instant food logging warnings** and the corresponding **end-of-day score explanations**. Current U.S. dietary guidance emphasizes nutrient-dense foods and reducing excess added sugars, refined carbohydrates, sodium and less favorable fat sources.&#x20;

Food and Nutrition Administration+1



| ID  | Scenario                                                  | Expected Humai behavior                                                                | Priority |
| --- | --------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------- |
| C01 | Sweetened soda pushes added sugar above a reference limit | Immediate warning; identify its contribution in daily review                           | P0       |
| C02 | Fruit contains substantial natural sugar                  | Distinguish naturally occurring sugar from added sugar; evaluate the whole food        | P0       |
| C03 | User eats gulab jamun, jalebi or another sweet            | Use estimated portion and recipe data; warn about added sugar when supported           | P1       |
| C04 | User logs deep-fried samosa, pakora or chicken            | Consider cooking method, oil absorption, total fat and energy density                  | P1       |
| C05 | Fried food has no known oil type                          | Warn about uncertainty; do not invent trans-fat content                                | P0       |
| C06 | Recipe uses ghee or butter frequently                     | Account for saturated fat using known quantities                                       | P1       |
| C07 | User eats nuts, seeds or avocado                          | Recognize fat quality while still counting calories                                    | P1       |
| C08 | Packaged food contains partially hydrogenated oil         | Flag the ingredient and relevant trans-fat concern, regardless of rounded label values | P0       |
| C09 | Daily sodium is high from packaged foods                  | Identify contributing foods; apply a reviewed moderation rule                          | P1       |
| C10 | One treat occurs within an otherwise nutritious week      | Give proportional feedback without treating a single food as failure                   | P1       |

I would also require Humai to avoid moral labels such as "cheating," "bad person," or "ruined your diet."

### **D. Micronutrients, fiber and dietary adequacy — 10 cases**

This is an especially important missing area. Nutrient inadequacy is often invisible in calorie and protein totals.

| ID  | Scenario                                       | Expected Humai behavior                                                                       | Priority |
| --- | ---------------------------------------------- | --------------------------------------------------------------------------------------------- | -------- |
| D01 | Fiber persistently below appropriate intake    | Show trend and practical food sources                                                         | P1       |
| D02 | Fiber suddenly increases and bloating begins   | Recognize a possible temporal association; suggest gradual adjustments from approved guidance | P1       |
| D03 | Low vitamin B12 intake pattern in a vegan user | Identify dietary coverage concerns; avoid diagnosing deficiency                               | P1       |
| D04 | Insufficient dietary iron sources              | Review dietary pattern and relevant risk context                                              | P1       |
| D05 | Calcium intake appears low                     | Suggest suitable food sources; consider life stage                                            | P1       |
| D06 | Vitamin D intake appears low                   | Explain that diet alone cannot establish vitamin D status                                     | P1       |
| D07 | Potassium intake appears high                  | Usually avoid blanket warnings; apply reviewed restrictions only where relevant               | P0       |
| D08 | Omega-3-rich foods rarely appear               | Suggest appropriate food options when relevant                                                | P2       |
| D09 | User eats the same limited foods every day     | Assess diversity and nutritional coverage over time                                           | P1       |
| D10 | Nutrition database lacks micronutrient data    | Mark nutrients unknown; do not treat unknown as zero or declare deficiency                    | P0       |

I would add **rolling 7-, 14-, and 30-day dietary adequacy summaries** for nutrients where longer-term patterns are more meaningful than one day's intake.

### **E. Meal timing, appetite and eating patterns — 10 cases**

Humai should not assume everyone needs six meals per day or that skipping breakfast is inherently unhealthy.

| ID  | Scenario                                                         | Expected Humai behavior                                                                     | Priority |
| --- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | -------- |
| E01 | User practices intermittent fasting                              | Support the eating schedule if appropriate, while evaluating overall adequacy               | P1       |
| E02 | User skips breakfast but meets nutritional needs                 | No automatic deduction for skipping breakfast                                               | P0       |
| E03 | User eats most calories at dinner                                | Evaluate total intake, preferences and symptom patterns                                     | P1       |
| E04 | Late meals are associated with reflux symptoms                   | Identify possible pattern; offer reviewed guidance                                          | P1       |
| E05 | User reports excessive hunger during fat loss                    | Review deficit size, protein, fiber, meals and sleep                                        | P1       |
| E06 | User feels uncomfortably full during weight gain                 | Suggest appropriate strategies for distributing intake; screen persistent symptoms          | P1       |
| E07 | User repeatedly reports binge eating or loss of control          | Avoid punitive coaching; offer supportive escalation and appropriate professional resources | P0       |
| E08 | User restricts food all day then eats large amounts at night     | Review sustainability and possible disordered eating; avoid harsh compensatory advice       | P0       |
| E09 | User works night shifts                                          | Use actual sleep/wake schedule and local time, not rigid daytime assumptions                | P1       |
| E10 | User observes religious fasting or has cultural meal preferences | Adapt timing and food options without requiring a universal eating pattern                  | P1       |

### **F. Training, muscle growth and recovery — 10 cases**

These cases should test the intersection of food intake and exercise. ACSM's 2026 resistance-training position stand supports progressive, individualized training instead of treating workout duration or steps as the only indicators of training quality.&#x20;

pubmed.ncbi.nlm.nih.gov+1



| ID  | Scenario                                                                | Expected Humai behavior                                                               | Priority |
| --- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | -------- |
| F01 | Weight-loss user walks extensively but never performs strength training | Award movement credit; explain the value of suitable resistance training              | P1       |
| F02 | Muscle-gain user trains but eats too little                             | Review energy adequacy and protein                                                    | P1       |
| F03 | User trains seven days with persistent fatigue                          | Assess workload and recommend appropriate recovery review                             | P1       |
| F04 | Planned rest day with weekly training on target                         | Preserve appropriate activity credit; do not demand an extra workout                  | P0       |
| F05 | User asks to burn off a 200-kcal overeating episode                     | Explain estimated energy balance and optional activity without mandatory compensation | P0       |
| F06 | Endurance athlete exercises for prolonged periods                       | Assess fueling, hydration and session demands                                         | P1       |
| F07 | User's training performance suddenly declines                           | Review nutrition, sleep, recovery and possible illness; escalate when warranted       | P1       |
| F08 | User has mobility limitations                                           | Evaluate an accessible, individualized activity plan                                  | P0       |
| F09 | Wearable records the same workout twice                                 | Deduplicate activity and avoid inflated energy estimates                              | P0       |
| F10 | User has severe muscle pain, weakness or dark urine after exercise      | Trigger urgent medical escalation rather than routine recovery coaching               | P0       |

### **G. Sleep, stress, energy and subjective wellbeing — 10 cases**

These are relevant to coaching but must not become arbitrary medical diagnoses.

| ID  | Scenario                                                         | Expected Humai behavior                                                           | Priority |
| --- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------- | -------- |
| G01 | User cannot fall asleep after late training                      | Ask about workout timing, caffeine, symptoms and sleep schedule                   | P1       |
| G02 | User sleeps only four or five hours repeatedly                   | Provide reviewed sleep guidance and recommend evaluation when persistent          | P1       |
| G03 | User has adequate sleep duration but feels exhausted             | Avoid assuming sleep is good solely from duration                                 | P1       |
| G04 | High caffeine or pre-workout use coincides with poor sleep       | Identify possible association and review dose/timing                              | P1       |
| G05 | Wearable indicates low HRV on one day                            | Avoid treating a single HRV number as illness or automatic workout prohibition    | P0       |
| G06 | Persistent insomnia despite sleep-habit changes                  | Recommend appropriate professional evaluation, not automatic supplement treatment | P1       |
| G07 | User reports high stress and emotional eating                    | Provide supportive behavioral guidance without shaming                            | P1       |
| G08 | User experiences dizziness while exercising                      | Stop routine exercise coaching and assess need for prompt medical attention       | P0       |
| G09 | User reports persistent fatigue during calorie restriction       | Assess possible low energy intake and recommend evaluation as appropriate         | P1       |
| G10 | User reports daytime sleepiness or possible sleep apnea symptoms | Recommend professional evaluation rather than simply suggesting earlier bedtime   | P1       |

### **H. Digestive symptoms and food tolerance — 10 cases**

The NIDDK guidance on constipation and acid reflux supports symptom-specific questions and recognition of warning signs. Neither condition should be diagnosed from the name of a logged food alone.&#x20;

NIDDK+2



| ID  | Scenario                                                            | Expected Humai behavior                                                           | Priority |
| --- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------- | -------- |
| H01 | Burning after spicy food                                            | Ask location, timing, severity and frequency; avoid assuming protein is the cause | P1       |
| H02 | Constipation after switching to high-protein meals                  | Review fiber, fluids, relevant medication changes and symptom history             | P1       |
| H03 | Bloating after high-fiber foods                                     | Explore changes in fiber quantity, food preparation and tolerance                 | P1       |
| H04 | Diarrhea after milk or whey                                         | Consider possible food-tolerance patterns without diagnosing lactose intolerance  | P1       |
| H05 | Bloating after beans, lentils or chickpeas                          | Offer reviewed preparation and gradual-adjustment guidance                        | P1       |
| H06 | Abdominal discomfort following protein supplements                  | Review ingredients, serving size and other possible contributors                  | P1       |
| H07 | Heartburn after large late meals                                    | Offer appropriate reflux-related education                                        | P1       |
| H08 | Persistent abdominal symptoms despite dietary changes               | Encourage medical evaluation                                                      | P0       |
| H09 | Abdominal pain with blood in stool or black stools                  | Medical escalation; do not provide routine diet-only advice                       | P0       |
| H10 | Severe abdominal pain with vomiting or concerning systemic symptoms | Urgent medical assessment pathway                                                 | P0       |

### **I. Medical conditions and personalized nutrition restrictions — 10 cases**

These are **not ordinary wellness-scoring cases**. The relevant safety rules should take precedence over a user's selected body-composition goal.

For example, diabetes nutrition guidance emphasizes individualized meal plans and medication context, while kidney-disease guidance requires individually tailored protein, potassium, phosphorus and sodium advice.&#x20;

pmc.ncbi.nlm.nih.gov+2



| ID  | Scenario                                                                  | Expected Humai behavior                                                                 | Priority |
| --- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | -------- |
| I01 | Diabetes user takes insulin and wants aggressive carbohydrate restriction | Do not offer generic low-carb advice without medication-related safety review           | P0       |
| I02 | User reports symptoms suggestive of low blood glucose                     | Follow an approved safety pathway; do not treat as a routine calorie issue              | P0       |
| I03 | User with elevated triglycerides logs substantial added sugar regularly   | Provide relevant dietary-quality insights and encourage appropriate follow-up           | P1       |
| I04 | User with elevated LDL frequently consumes saturated-fat-rich foods       | Personalize reviewed fat-quality guidance                                               | P1       |
| I05 | User with CKD selects muscle gain                                         | Do not apply universal bodybuilding protein targets; require individualized guidance    | P0       |
| I06 | User with hypertension consumes high-sodium foods                         | Apply relevant reviewed sodium guidance                                                 | P1       |
| I07 | User with a medically diagnosed food allergy logs a possible allergen     | Show a safety warning regardless of the score                                           | P0       |
| I08 | User with celiac disease logs gluten-containing food                      | Apply appropriate gluten-avoidance safeguards, including uncertainty from cross-contact | P0       |
| I09 | User reports PCOS or thyroid disease                                      | Avoid simplistic causal claims or promising one diet will treat the condition           | P1       |
| I10 | User has multiple conditions with potentially conflicting restrictions    | Route to professional review rather than combining generic rules mechanically           | P0       |

Food-allergy identification also needs a proper ingredient and cross-contact model, not just matching the food's display name. The FDA identifies nine major allergens under U.S. food-labeling rules.&#x20;

FDA+1



### **J. Supplements, medications and special populations — 10 cases**

This domain is crucial to preventing well-intentioned but unsafe suggestions.

| ID  | Scenario                                                                    | Expected Humai behavior                                                                                                 | Priority |
| --- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------- |
| J01 | User asks whether magnesium will improve sleep                              | Explain uncertain benefit and possible risks; don't automatically recommend supplementation                             | P0       |
| J02 | User reports taking several supplements with overlapping ingredients        | Check for possible duplication and refer for interaction review                                                         | P1       |
| J03 | User wants creatine for strength training                                   | Provide approved education appropriate to health context; distinguish benefits from contraindications and uncertainties | P1       |
| J04 | User begins a weight-loss medication and experiences nausea or constipation | Recognize medication relevance; direct treatment decisions to the prescribing professional                              | P0       |
| J05 | User takes medicine affected by food or supplements                         | Prevent unsupported interaction advice; escalate to clinician/pharmacist                                                | P0       |
| J06 | User is pregnant and chooses weight loss                                    | Do not apply an ordinary weight-loss algorithm; require pregnancy-appropriate care pathway                              | P0       |
| J07 | User is breastfeeding and wants an aggressive deficit                       | Require appropriate life-stage guidance and assessment                                                                  | P0       |
| J08 | User is under 18                                                            | Do not use the adult weight-management engine; keep unsupported features unavailable                                    | P0       |
| J09 | Older adult is unintentionally losing weight                                | Prioritize evaluation of nutritional risk and functional needs                                                          | P0       |
| J10 | User shows restrictive or compulsive eating/exercise behaviors              | Avoid triggering numbers or compensatory prompts; offer supportive professional referral                                | P0       |

Pregnancy, older age, and eating-disorder risk are particularly strong reasons not to assume one universal calorie algorithm is appropriate.&#x20;

ACOG+2



### **K. Logging, food data, and measurement uncertainty — 10 cases**

I consider these **essential to trust**. Even excellent nutritional rules fail if the underlying data is wrong.

| ID  | Scenario                                             | Expected Humai behavior                                                                    | Priority |
| --- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------ | -------- |
| K01 | User logs only breakfast                             | Show partial progress, not a definitive low-calorie full-day assessment                    | P0       |
| K02 | User never logs food but records steps               | No nutrition points awarded or inferred; display limited data coverage                     | P0       |
| K03 | Photo of biryani cannot identify oil amount          | Use an explicitly uncertain estimate; ask for portion or recipe details                    | P0       |
| K04 | Same food logged in raw and cooked weights           | Convert using appropriate food-state data; never treat weights as interchangeable          | P0       |
| K05 | Recipe portion changes from one to two servings      | Recalculate all supported nutrients consistently                                           | P0       |
| K06 | Food label shows 0 g trans fat due to rounding       | Preserve label facts and ingredient-level warnings without claiming a measured zero        | P1       |
| K07 | Database has calories but no added-sugar value       | Added sugar is unknown, not zero                                                           | P0       |
| K08 | Barcode scan and photo log refer to the same food    | Detect possible duplicate entries and seek confirmation                                    | P0       |
| K09 | Wearable energy expenditure appears implausible      | Apply validation and uncertainty handling; don't create a large automatic eating allowance | P0       |
| K10 | User changes time zone or logs a meal after midnight | Attribute records to correct local eating day and preserve original timestamps             | P1       |

### **L. Long-term progress, behavior and real-world situations — 10 cases**

These cover the situations that often derail an otherwise sound plan.

| ID  | Scenario                                                                  | Expected Humai behavior                                                                  | Priority |
| --- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | -------- |
| L01 | Weight rises after a high-sodium meal                                     | Explain possible short-term water fluctuation; avoid declaring fat gain                  | P1       |
| L02 | User loses weight rapidly and repeatedly                                  | Evaluate whether rate and symptoms warrant review; don't reward faster loss indefinitely | P0       |
| L03 | Weight trend plateaus over several weeks                                  | Reassess energy estimates, logging, activity and adherence before changing goals         | P1       |
| L04 | Muscle-gain user improves strength but weight stays stable                | Recognize progress without promising muscle gain from strength alone                     | P1       |
| L05 | Weight-gain user gains quickly with no strength improvement               | Review surplus size and training response                                                | P1       |
| L06 | User eats out at restaurants frequently                                   | Support uncertain portions, sauces and cooking oils without discouraging eating out      | P1       |
| L07 | User has limited food budget                                              | Recommend affordable, culturally appropriate foods instead of expensive products         | P1       |
| L08 | User travels, attends celebrations or misses logging days                 | Support realistic plan adjustments without shame or streak penalties                     | P1       |
| L09 | User reaches the selected goal                                            | Offer a transition to maintenance or another chosen goal, with explicit confirmation     | P1       |
| L10 | User's score looks excellent but their real-world goal is not progressing | Trigger an outcome review rather than claiming success                                   | P0       |

## **What I would change about the scoring mathematics**

After going through these cases, I would **not freeze the exact nutrient scoring formulas yet**.

Several scenarios reveal that the engine needs more expressive scoring functions than a simple percentage of target consumed.

## **Five scoring behaviors**

**1. Adequacy**

Reward appropriate intake of nutrients such as protein or fiber up to an individualized target. Above-target intake does not automatically earn extra points.

**2. Target range**

Energy and certain nutrient goals have an appropriate range. Being too low or too high can both matter, depending on goal and context.

**3. Moderation**

Added sugar, saturated fat, sodium and similar factors are assessed using relevant reviewed thresholds. Never invent missing values.

**4. Pattern-based**

Food diversity, micronutrient coverage, training consistency and progress should often be evaluated over multiple days or weeks.

**5. Safety override**

When a safety concern makes ordinary scoring inappropriate, suppress or qualify the affected score and provide the appropriate next step.

I would retain our proposed **40 nutrition + 20 food quality + 20 activity + 15 sleep/recovery + 5 hydration** as the initial design for testing, but not as a medically validated scoring scale.

We should also create an explicit policy for situations where a category is genuinely not applicable. **Missing data, failed targets, and medically inapplicable targets must not all become identical zeroes.** I would show fixed earned points and coverage for ordinary missing logs, while qualifying or suspending the composite score when applying its denominator would be misleading or unsafe. That is preferable to automatically reallocating weights behind the scenes.

## **How Humai should decide what to do for each scenario**

One scenario should not always produce one canned response. I recommend four possible outcomes.

**A. Automatic scoring and feedback**

Safe, deterministic calculations: recorded calories, protein adequacy, food-quality contributions, and normal goal progress.

**B. Ask for missing information**

When preparation, portion, symptom location, timing, or nutrient values are unclear, Humai asks a small number of relevant questions before making stronger claims.

**C. Professionally reviewed guidance**

Only eligible, approved recommendations are delivered. New or complex cases enter the dietitian or clinician review workflow with user consent.

**D. Medical escalation**

Concerning symptoms, possible emergencies, serious interactions or situations outside the app's scope should not be handled as ordinary fitness coaching.

## **What every scenario must contain in the database**

I would insist that Devin model these as versioned, testable scenario definitions rather than hardcoded AI prompts.

Each scenario should include:

- **Identity:** ID, category, priority, supported goals and rule version.
- **Eligibility:** Age group, life stage, relevant health restrictions and applicable user context.
- **Inputs:** Food logs, nutrients, activity, symptoms, trends and required data confidence.
- **Conditions:** Exact reviewed triggers and exclusions.
- **Scoring:** Which component is affected, the calculation, maximum points and uncertainty handling.
- **User experience:** Instant warning, daily score explanation, weekly review, or symptom response.
- **Guidance:** Approved content, evidence source, reviewer and expiration/review date.
- **Safety:** Red flags, contraindications, escalation category and required professional qualifications.
- **Tests:** Positive cases, negative cases, incomplete data, conflicting rules, and expected outcomes.

For example, scenario C04 ("deep-fried food") should never just say `isDeepFried = true → score -5`. It should evaluate what is known about the food, its ingredients, cooking method, portion, and the relevant nutrient totals. When the data is uncertain, the app should communicate that uncertainty.

## **The testing matrix I would require**

## **Scenario validation coverage**

# **120**

Core scenarios

# **6**

Primary goal profiles

# **4**

Data-quality states

# **2,880**

Potential test combinations

120 × 6 × 4 is a proposed coverage target, not 2,880 distinct clinical recommendations. Not every combination is applicable; inapplicable combinations must be excluded explicitly, while important scenarios need additional boundary tests.

The four baseline data-quality states should be **missing, partially known, sufficiently reliable, and conflicting/implausible**.

For each applicable combination, verify that Humai:

1. Selects the correct active goal and personalized target.
2. Respects safety constraints before ordinary scoring.
3. Calculates points deterministically without double-counting.
4. Explains exactly which recorded inputs influenced the score.
5. Suggests only approved guidance appropriate to the situation.
6. Preserves source information and rule versions for auditability.

## **My recommended implementation order**

P0

**Build safety and scoring correctness first**

Goal selection, correct calorie accounting, missing data, food allergies, serious symptom escalation, disordered-eating safeguards, medically inappropriate targets, and score traceability.

P1

**Build the complete coaching experience**

Food-quality insights, nutrient adequacy, exercise planning, sleep, digestive check-ins, weekly progress reviews, and approved professional guidance.

P2

**Expand personalization**

Advanced dietary patterns, nuanced sports fueling, deeper wearable trends, more specialized condition pathways, and sophisticated food-tolerance insights.

All three sets can be developed under server-enforced feature flags, as we've agreed, while releases remain phased.

## **One additional improvement: don't make professional review a formality**

A dietitian's approval of a general food recommendation does not mean that recommendation is safe for everyone. Likewise, a fitness certification alone doesn't qualify someone to evaluate significant medical symptoms.

I would require qualified reviewers to approve the **evidence, applicability conditions, exceptions and escalation criteria** together. For symptom-related care, the professional's role and licensure must match the content being approved.

No AI-generated medical response should become automatically approved merely because it resembles previously reviewed advice.

The engine should also be able to say **"I don't have enough information to make a safe recommendation"** and still help the user find the appropriate next step.

## **What I think is still missing before the Devin master prompt**

The 120 scenarios establish breadth, but three deeper pieces still need design work:

**First, the exact mathematical scoring specification.** We need to decide how each point is earned or withheld, what confidence is required, how overconsumption is assessed, and how to prevent scoring loopholes.

**Second, the recommendation decision system.** We need to specify when Humai recommends changing food portions, increasing dietary variety, modifying activity, taking rest, monitoring symptoms, or seeking professional care—and when it must remain silent.

**Third, the outcome-feedback algorithm.** Humai should learn when a person's agreed plan is not producing the expected trend, without assuming that the individual is doing something wrong or automatically making the program more restrictive.

The strongest foundation is the Academy's approach of **assessment → intervention → monitoring and reassessment**, adapted for consumer software with appropriate professional oversight.&#x20;

eatrightpro.org+2



