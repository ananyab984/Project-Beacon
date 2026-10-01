SELECT COUNT(*) as total_faqs FROM faq_entries WHERE is_active = true;
SELECT id, category, question FROM faq_entries ORDER BY created_at LIMIT 5;
