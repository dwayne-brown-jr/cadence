import { createUploadthing, type FileRouter } from "uploadthing/next";
import { requireAuth, requireWorkspace } from "./api-helpers";

const f = createUploadthing();

export const ourFileRouter = {
  clientDocumentUploader: f({
    pdf: { maxFileSize: "16MB" },
    image: { maxFileSize: "8MB" },
    "application/msword": { maxFileSize: "16MB" },
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": {
      maxFileSize: "16MB",
    },
    "application/vnd.ms-excel": { maxFileSize: "16MB" },
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {
      maxFileSize: "16MB",
    },
  })
    .middleware(async ({ req }) => {
      const { userId, error } = await requireAuth();
      if (error) throw new Error("Unauthorized");
      const { workspace, error: wsError } = await requireWorkspace(userId);
      if (wsError) throw new Error("Workspace not found");
      const clientId = req.headers.get("x-client-id") ?? "";
      const { prisma } = await import("./prisma");
      const client = await prisma.client.findFirst({
        where: { id: clientId, workspaceId: workspace.id },
        select: { id: true },
      });
      if (!client) throw new Error("Client not found");
      return { userId, workspaceId: workspace.id, clientId: client.id };
    })
    .onUploadComplete(async ({ metadata, file }) => {
      const { prisma } = await import("./prisma");
      await prisma.document.create({
        data: {
          name: file.name,
          url: file.ufsUrl,
          size: file.size,
          mimeType: file.type,
          uploadedBy: metadata.userId,
          clientId: metadata.clientId,
        },
      });
    }),
  portalDocumentUploader: f({
    pdf: { maxFileSize: "16MB" },
    image: { maxFileSize: "8MB" },
    "application/msword": { maxFileSize: "16MB" },
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": {
      maxFileSize: "16MB",
    },
    "application/vnd.ms-excel": { maxFileSize: "16MB" },
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {
      maxFileSize: "16MB",
    },
  })
    .middleware(async ({ req }) => {
      const portalToken = req.headers.get("x-portal-token") ?? "";
      if (!portalToken) throw new Error("Missing portal token");
      const { prisma } = await import("./prisma");
      const client = await prisma.client.findUnique({
        where: { portalToken },
        select: { id: true, workspaceId: true, workspace: { select: { portalEnabled: true } } },
      });
      if (!client || !client.workspace.portalEnabled) throw new Error("Invalid portal token");
      return { clientId: client.id, uploadedBy: "portal" };
    })
    .onUploadComplete(async ({ metadata, file }) => {
      const { prisma } = await import("./prisma");
      await prisma.document.create({
        data: {
          name: file.name,
          url: file.ufsUrl,
          size: file.size,
          mimeType: file.type,
          uploadedBy: metadata.uploadedBy,
          clientId: metadata.clientId,
        },
      });
    }),
} satisfies FileRouter;

export type OurFileRouter = typeof ourFileRouter;
