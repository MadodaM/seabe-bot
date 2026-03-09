// routes/lms_admin.js
// PURPOSE: Handles all AI Course Builder & Module Logic
const express = require('express');
const router = express.Router();
const fs = require('fs');
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });
const { processAndImportCoursePDF } = require('../services/courseImporter');

// Helper to render pages (copied from platform.js to maintain style)
// In a real app, this render function should be in a shared 'utils/ui.js' file
const renderAdminPage = (title, content, error) => { /* ... insert standard UI code here or require it ... */ };

module.exports = function(prisma, renderPageFunc, isAuthenticated) {
    
    // 1. DASHBOARD: UPLOAD + LIST
    router.get('/', async (req, res) => {
        if (!isAuthenticated(req)) return res.redirect('/login');
        try {
            const churches = await prisma.church.findMany({ select: { id: true, name: true } });
            let options = churches.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
            const courses = await prisma.course.findMany({ include: { church: true, _count: { select: { modules: true } } }, orderBy: { id: 'desc' } });

            const courseRows = courses.map(c => `<tr><td><strong>${c.title}</strong><br><span style="font-size:11px;color:#999;">${c.code||'N/A'}</span></td><td>${c.church?c.church.name:'Global'}</td><td>R${c.price}</td><td>${c._count.modules} Mods</td><td>${c.status}</td><td><a href="/admin/course-builder/edit/${c.id}" class="btn btn-edit">Edit</a> <form method="POST" action="/admin/course-builder/delete" style="display:inline;"><input type="hidden" name="id" value="${c.id}"><button class="btn btn-danger">Del</button></form></td></tr>`).join('');

            res.send(renderPageFunc('AI Course Builder', `
                <div style="display:grid; grid-template-columns: 1fr 1.5fr; gap:30px; align-items:start;">
                    <div class="card-form"><h3>🤖 AI Generator</h3><form id="courseUploadForm"><div class="form-group"><label>Org</label><select id="orgId">${options}</select></div><div class="form-group"><label>Price</label><input id="price" type="number" value="0"></div><div class="form-group"><label>PDF</label><input type="file" id="pdfFile" accept=".pdf"></div><button id="submitBtn" class="btn btn-primary" style="width:100%">Generate</button><div id="statusBox"></div></form></div>
                    <div class="card-form"><h3>📚 Courses</h3><table><thead><tr><th>Title</th><th>Org</th><th>Price</th><th>Size</th><th>Status</th><th>Action</th></tr></thead><tbody>${courseRows}</tbody></table></div>
                </div>
                <script>document.getElementById('courseUploadForm').addEventListener('submit',async(e)=>{e.preventDefault();const b=document.getElementById('submitBtn'),s=document.getElementById('statusBox');b.innerText='⏳...';b.disabled=true;const f=new FormData();f.append('orgId',document.getElementById('orgId').value);f.append('price',document.getElementById('price').value);f.append('coursePdf',document.getElementById('pdfFile').files[0]);try{const r=await fetch('/api/admin/parse-course',{method:'POST',body:f});const d=await r.json();if(d.success){s.innerHTML='✅ Success!';setTimeout(()=>location.reload(),2000);}else throw new Error(d.error);}catch(err){s.innerText='❌ '+err.message;b.disabled=false;}});</script>
            `));
        } catch (e) { res.send(renderPageFunc('Error', '', e.message)); }
    });

    // 2. EDIT COURSE
    router.get('/edit/:id', async (req, res) => {
        if (!isAuthenticated(req)) return res.redirect('/login');
        try {
            const course = await prisma.course.findUnique({ where: { id: parseInt(req.params.id) }, include: { modules: { orderBy: { order: 'asc' } } } });
            const mods = course.modules.map(m => `<div style="background:#f8f9fa; padding:10px; margin-bottom:5px; border-left:3px solid #00d2d3; display:flex; justify-content:space-between;"><span>Day ${m.order}: ${m.title}</span> <a href="/admin/course-builder/module/edit/${m.id}" class="btn btn-edit">Edit</a></div>`).join('');
            res.send(renderPageFunc(`Edit: ${course.title}`, `<div style="display:grid; grid-template-columns: 1fr 1fr; gap:30px;"><div class="card-form"><form action="/admin/course-builder/update" method="POST"><input type="hidden" name="id" value="${course.id}"><div class="form-group"><label>Title</label><input name="title" value="${course.title}"></div><div class="form-group"><label>Desc</label><textarea name="description">${course.description||''}</textarea></div><div class="form-group"><label>Price</label><input name="price" value="${course.price}"></div><div class="form-group"><label>Status</label><select name="status"><option value="DRAFT" ${course.status==='DRAFT'?'selected':''}>Draft</option><option value="LIVE" ${course.status==='LIVE'?'selected':''}>Live</option></select></div><button class="btn btn-save">Save</button></form></div><div class="card-form"><h3>Modules</h3>${mods}</div></div>`));
        } catch (e) { res.send(renderPageFunc('Error', '', e.message)); }
    });

    // 3. EDIT MODULE
    router.get('/module/edit/:moduleId', async (req, res) => {
        if (!isAuthenticated(req)) return res.redirect('/login');
        try {
            const m = await prisma.module.findUnique({ where: { id: parseInt(req.params.moduleId) } });
            res.send(renderPageFunc(`Edit Module`, `
                <div class="card-form" style="max-width:700px;">
                    <form action="/admin/course-builder/module/update" method="POST">
                        <input type="hidden" name="id" value="${m.id}"><input type="hidden" name="courseId" value="${m.courseId}">
                        <div style="display:grid; grid-template-columns: 80px 1fr; gap:10px;"><div class="form-group"><label>Day</label><input name="order" value="${m.order}"></div><div class="form-group"><label>Title</label><input name="title" value="${m.title}"></div></div>
                        <div class="form-group"><label>Text</label><textarea name="dailyLessonText" rows="10">${m.dailyLessonText||m.content||''}</textarea></div>
                        <div class="form-group" style="background:#fffbe6; padding:10px;"><label>Quiz Q</label><input name="quizQuestion" value="${m.quizQuestion||''}"><label>Quiz A</label><textarea name="quizAnswer">${m.quizAnswer||''}</textarea></div>
                        <div class="form-group"><label>Media</label><select name="type"><option value="TEXT" ${m.type==='TEXT'?'selected':''}>Text</option><option value="PDF" ${m.type==='PDF'?'selected':''}>PDF</option><option value="VIDEO" ${m.type==='VIDEO'?'selected':''}>Video</option></select><input name="contentUrl" value="${m.contentUrl||''}" placeholder="URL"></div>
                        <div style="display:flex; gap:10px;"><button class="btn btn-save" style="flex:1;">Save</button><button type="button" onclick="if(confirm('Del?')) document.getElementById('dF').submit();" class="btn btn-danger">Delete</button></div>
                    </form>
                    <form id="dF" action="/admin/course-builder/module/delete" method="POST"><input type="hidden" name="id" value="${m.id}"><input type="hidden" name="courseId" value="${m.courseId}"></form>
                </div>
            `));
        } catch (e) { res.send(renderPageFunc('Error', '', e.message)); }
    });

    // 4. POST ACTIONS
    router.post('/update', async (req, res) => {
        await prisma.course.update({ where: { id: parseInt(req.body.id) }, data: { title: req.body.title, description: req.body.description, price: parseFloat(req.body.price), status: req.body.status } });
        res.redirect('/admin/course-builder');
    });

    router.post('/delete', async (req, res) => {
        await prisma.course.delete({ where: { id: parseInt(req.body.id) } });
        res.redirect('/admin/course-builder');
    });

    router.post('/module/update', async (req, res) => {
        await prisma.module.update({ where: { id: parseInt(req.body.id) }, data: { title: req.body.title, order: parseInt(req.body.order), dailyLessonText: req.body.dailyLessonText, content: req.body.dailyLessonText, quizQuestion: req.body.quizQuestion, quizAnswer: req.body.quizAnswer, type: req.body.type, contentUrl: req.body.contentUrl } });
        res.redirect(`/admin/course-builder/edit/${req.body.courseId}`);
    });

    router.post('/module/delete', async (req, res) => {
        await prisma.module.delete({ where: { id: parseInt(req.body.id) } });
        res.redirect(`/admin/course-builder/edit/${req.body.courseId}`);
    });

    return router;
};