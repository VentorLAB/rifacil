-- CreateIndex
CREATE INDEX "contact_name_trgm" ON "Contact" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "contact_phone_trgm" ON "Contact" USING GIN ("phone" gin_trgm_ops);
