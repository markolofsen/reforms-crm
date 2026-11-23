import { activityDto } from "@hub/contract/activity";
import { knowledgeListDto, knowledgeListQuery, knowledgeTextDto, knowledgeTextQuery } from "@hub/contract/knowledge";
import { activityQuery, projectQuery, slugParam } from "@hub/contract/requests";
import { projectLinksDto, projectOverviewDto, projectsDto } from "@hub/contract/responses";
import { doctorDto } from "@hub/contract/sending";
import { enrollmentChangedDto, enrollmentParam, enrollmentsDto, enrollmentsQuery, sequencesDto, slugOnlyParam, stopBody } from "@hub/contract/sequences";
import type { Operation } from "../http/openapi";

/** The projects domain's operations (P120 W2): the list, one project's page, its knowledge, links, activity and follow-ups. */
export const operations: Operation[] = [
  { method: "get", path: "/api/projects", operationId: "listProjects", summary: "List the instance's projects", tags: ["meta"], reply: { name: "Projects", schema: projectsDto }, errors: [503] },
  { method: "get", path: "/api/project", operationId: "getProjectOverview", summary: "Read one project's page", tags: ["meta"], query: projectQuery, reply: { name: "ProjectOverview", schema: projectOverviewDto }, errors: [400, 404, 503] },
  { method: "get", path: "/api/project/doctor", operationId: "getProjectDoctor", summary: "Run the project's send checks (read only)", tags: ["meta"], query: projectQuery, reply: { name: "Doctor", schema: doctorDto }, errors: [400, 404, 503] },
  { method: "get", path: "/api/activity", operationId: "getActivity", summary: "Read the project's activity", tags: ["meta"], query: activityQuery, reply: { name: "Activity", schema: activityDto }, errors: [400, 503] },
  { method: "get", path: "/api/projects/:slug/links", operationId: "getProjectLinks", summary: "Read project Quick Links", tags: ["meta"], params: slugParam, reply: { name: "ProjectLinks", schema: projectLinksDto }, errors: [404, 503] },
  { method: "get", path: "/api/projects/:slug/knowledge", operationId: "listKnowledge", summary: "List the project's knowledge", tags: ["meta"], params: slugParam, query: knowledgeListQuery, reply: { name: "Knowledge", schema: knowledgeListDto }, errors: [404, 503] },
  { method: "get", path: "/api/projects/:slug/knowledge/text", operationId: "getKnowledgeText", summary: "Read one knowledge entry's text", tags: ["meta"], params: slugParam, query: knowledgeTextQuery, reply: { name: "KnowledgeText", schema: knowledgeTextDto }, errors: [400, 404] },
  { method: "get", path: "/api/projects/:slug/sequences", operationId: "listSequences", summary: "List the project's follow-up sequences", tags: ["mail"], params: slugOnlyParam, reply: { name: "Sequences", schema: sequencesDto }, errors: [404, 503] },
  { method: "get", path: "/api/projects/:slug/enrollments", operationId: "listEnrollments", summary: "List the project's follow-up enrolments", tags: ["mail"], params: slugOnlyParam, query: enrollmentsQuery, reply: { name: "Enrollments", schema: enrollmentsDto }, errors: [404, 503] },
  { method: "post", path: "/api/projects/:slug/enrollments/:id/stop", operationId: "stopEnrollment", summary: "Stop one enrolment", tags: ["mail"], params: enrollmentParam, body: { name: "StopEnrollmentBody", schema: stopBody }, reply: { name: "EnrollmentChanged", schema: enrollmentChangedDto }, errors: [404, 409, 503] },
];
