-- DropIndex
DROP INDEX "TrainerDocumentShare_documentId_relationId_groupId_key";

-- CreateIndex
CREATE INDEX "TrainerDocumentShare_documentId_idx" ON "TrainerDocumentShare"("documentId");

-- CreateIndex
CREATE INDEX "TrainerDocumentShare_groupId_idx" ON "TrainerDocumentShare"("groupId");
