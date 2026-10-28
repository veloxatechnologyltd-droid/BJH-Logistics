import type { Metadata } from "next";
import { processSteps, projects } from "../content";
import { Icon } from "../Icon";
import { CtaBand, PageHero, SectionHeading } from "../Sections";

export const metadata: Metadata = {
  title: "Projects",
  description:
    "Mining, oil and gas, project cargo, humanitarian, automotive and scrap metal logistics in Ghana and West Africa.",
};

export default function ProjectsPage() {
  return (
    <>
      <PageHero eyebrow="Projects" title="Logistics for demanding industries">
        Heavy equipment, time-critical parts and large shipments need a partner
        who plans every step. These are the sectors we support.
      </PageHero>

      <section className="section">
        <div className="container">
          <div className="project-list">
            {projects.map((project, index) => (
              <article key={project.title} className="project-row reveal">
                <span className="project-index">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="icon-box large">
                  <Icon name={project.icon} size={30} />
                </span>
                <div>
                  <h2>{project.title}</h2>
                  <p>{project.summary}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section tinted">
        <div className="container">
          <SectionHeading
            eyebrow="Our approach"
            title="How we run a project shipment"
            center
          />
          <ol className="process reveal">
            {processSteps.map((step, index) => (
              <li
                key={step.title}
                style={{ transitionDelay: `${200 + index * 160}ms` }}
              >
                <span className="step-number">{index + 1}</span>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <CtaBand />
    </>
  );
}
