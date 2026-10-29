import type { Metadata } from "next";
import { processSteps, sectors, specialistServices } from "../content";
import { Icon } from "../Icon";
import { CtaBand, PageHero, SectionHeading } from "../Sections";

export const metadata: Metadata = {
  title: "Projects and specialist cargo",
  description:
    "Mining, oil and gas, humanitarian and automotive projects, plus project cargo, offshore and ship supply, ship agency, RoRo, container sales, cargo insurance, licence support and scrap metal export logistics from Tema, Ghana.",
};

export default function ProjectsPage() {
  return (
    <>
      <PageHero
        eyebrow="Projects and specialist cargo"
        title="For cargo that needs more than a standard booking"
      >
        These service paths can be combined with customs, transport, storage and
        documentation support.
      </PageHero>

      <section className="section dark">
        <div className="container">
          <SectionHeading
            eyebrow="Sectors"
            title="Project sectors we support"
          />
          <div className="card-grid two">
            {sectors.map((sector, index) => (
              <div
                key={sector.title}
                className="project-card reveal"
                style={{ transitionDelay: `${(index % 2) * 90}ms` }}
              >
                <span className="icon-box">
                  <Icon name={sector.icon} />
                </span>
                <h3>{sector.title}</h3>
                <p>{sector.summary}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <SectionHeading
            eyebrow="Specialist services"
            title="Service paths for demanding cargo"
          />
          <div className="project-list">
            {specialistServices.map((project, index) => (
              <article
                key={project.slug}
                id={project.slug}
                className="project-row reveal"
              >
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
