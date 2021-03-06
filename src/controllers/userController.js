import fetch from "node-fetch";
import bcrypt from "bcrypt";
import nodemailer from "nodemailer";
import User from "../models/User";
import { async } from "regenerator-runtime"; //프론트엔드에서 async를 사용하려면 regenerator Runtime을 사용해야함.

export const getJoin = (req, res) => {
    res.render("join", {pageTitle:"Join"});
};

export const postJoin = async (req,res) => {
    const {name, nickName, email, password, password2, location, emailCode} = req.body;
    const pageTitle = "Join";
    if(password !== password2 || password.includes(" ")) {
        req.flash("error", "Password confirmation does not match/Do not input spacebar in password.");
        return res.status(400).render("join", { pageTitle });
    }
    if(emailCode !== String(req.session.emailCode[email])) { //frontend에서 확인했지만 backend에서도 확인.
        req.flash("error", "Please confirm the email check code.");
        return res.status(400).render("join", { pageTitle });
    }
    req.session.emailCode = {};
    const exists = await User.exists({ $or: [ { nickName }, { email } ] });  //email이나 nickName둘중 하나라도 있으면 exists는 True
    if (exists) {
        req.flash("error", "This nickName/email is already taken.");
        return res.status(400).render("join", { pageTitle }); //상태 코드 400을 가지고 render를 하게됨.
    }
    try {
        await User.create({
            nickName,
            email,
            name,
            password,
            location,
        });
        req.flash("success", "Account is created.");
        return res.redirect("/login");
    } catch(error) {
        req.flash("error", "DB Error.");
        return res.status(400).render("join", { pageTitle });
    }
};

export const getLogin = (req, res) => res.render("login", {pageTitle:"Login"});
export const postLogin = async (req, res) => {
    const { nickName, password } = req.body;
    const pageTitle = "Login";
    const user = await User.findOne( { nickName, socialOnly: false });
    if(!user) {    //check if account exists
        req.flash("error", "This Nickname does not exist./Go social login.");
        return res.status(400).render("login", { pageTitle });
    }
    //check if password correct
    const ok = await bcrypt.compare(password, user.password);
    if(!ok) {
        req.flash("error", "Wrong password.");
        return res.status(400).render("login", { pageTitle });
    }
    req.session.loggedIn = true;    //세션에 정보추가
    req.session.user = user;
    
    return res.redirect("/");
};

export const handleLogout = (req, res) => {
    req.session.user = null;
    req.session.loggedIn = false;
    req.flash("info", "Bye Bye");
    return res.redirect("/");
};

export const startGithubLogin = (req, res) => {
    const baseUrl = "https://github.com/login/oauth/authorize";
    const config = {
        client_id: process.env.GH_CLIENT,
        allow_signup:false,
        scope:"read:user user:email"
    };
    const params = new URLSearchParams(config).toString();
    const finalUrl = `${baseUrl}?${params}`;
    return res.redirect(finalUrl);
};

export const finishGithubLogin = async (req, res) => {
    const baseUrl = "https://github.com/login/oauth/access_token";
    const config = {
        client_id: process.env.GH_CLIENT,
        client_secret: process.env.GH_SECRET,
        code: req.query.code   // 확인을 누르면 github에서 code를 줌.
    };
    const params = new URLSearchParams(config).toString();
    const finalUrl = `${baseUrl}?${params}`;
    const tokenRequest = await(    //해당 code를 가지고 access token을 가져옴.
        await fetch(finalUrl, {
            method:"POST",
            headers: {
                Accept: "application/json"
            }
        })
    ).json();
    if ("access_token" in tokenRequest) {  // 가져온 access token을 가지고 github api를 이용해 user정보를 가져옴 
        const { access_token } = tokenRequest;
        const apiUrl = "https://api.github.com"
        const userData = await ( 
            await fetch(`${apiUrl}/user`, {
                headers: {
                    Authorization: `token ${access_token}`
                }
            })
        ).json();
        const emailData = await (
            await fetch(`${apiUrl}/user/emails`, {
                headers: {
                    Authorization: `token ${access_token}`
                }
            })
        ).json();
        const emailObj = emailData.find(
            (email) => email.primary === true && email.verified === true
        );
        if(!emailObj) {
            //다시 확인해봐야함
            req.flash("error", "This github account is disabled.");
            return res.redirect("/login");
        }
        const avatarUrl = userData.avatar_url;
        const name = userData.name? userData.name : "Unknown";
        const { email } = emailObj;
        const { location } = userData;
        const nickName = userData.login;
        const userNickChk = await User.findOne( { nickName });
        let userEmailChk = await User.findOne( { email });
        if(!userEmailChk && !userNickChk) { //이메일 있는경우 해당 이메일로 로그인
            userEmailChk = await User.create({
                avatarUrl,
                name,
                socialOnly: true,
                nickName,
                email,
                password: "",
                location
            });
            req.session.loggedIn = true;
            req.session.user = userEmailChk;
            return res.redirect("/");
        } else if(!userEmailChk && userNickChk) {
            const user = { avatarUrl, email, name, location };
            req.session.socialNickChk = user;
            req.flash("error", "Nickname is duplicated.");
            return res.redirect("/users/socialDuplicated");
        } else {
            req.session.loggedIn = true;
            req.session.user = userEmailChk;
            return res.redirect("/");
        }
    } else { //access token이 없을 경우
        req.flash("error", "There is no access token.");
        return res.redirect("/login");
    }
};

export const getSocialDuplicated = async (req, res) => {
    return res.render("socialDuplicated", { pageTitle: "socialDuplicated", socialNickChk: req.session.socialNickChk });
}

export const postSocialDuplicated = async (req, res) => {
    const {
        body: { nickName, name, location },
        session: { socialNickChk: { email, avatarUrl} }
    } = req;
    try {
        const exists = await User.exists({ $or: [ { nickName }, { email } ] });  
        if (exists) {
            req.flash("error", "This nickName/email is already taken.");
            return res.sendStatus(404);
        }
        const user = await User.create({
            nickName,
            socialOnly: true,
            password: "",
            email,
            name,
            location,
            avatarUrl
        });
        req.flash("success", "Account is created.");
        req.session.loggedIn = true;
        req.session.user = user;
        req.session.socialNickChk = {};
        return res.redirect("/");
    } catch(error) {
        req.flash("error", "DB Error.");
        return res.sendStatus(404);
    }
}

export const userDetail = async(req, res) => {
    const { id } = req.params;
    const user = await User.findById(id).populate("videos");
    if(!user){
        return res.status(404).render("404", { pageTitle: "User not found" });
    }
    return res.render("userDetail", {
        pageTitle:`${user.name}'s Profile`, 
        user,
    });
};

export const getEdit = (req, res) => {
    res.render("editProfile", { pageTitle:"Edit Profile" });
};

export const postEdit = async(req, res) => {
    const { 
        session: {
            user: { _id, avatarUrl },
        },
        body: { nickName, email, name, location },
        file
    } = req;
    const current = await User.findById(_id);
    const nickChk = await User.findOne({ nickName });
    const emailChk = await User.findOne({ email });
    const isHeroku = process.env.NODE_ENV === "production";

    if(current.nickName !== nickName && nickChk._id !== _id) {
        req.flash("error", "Nickname is duplicated.");
        return res.render("editProfile", { pageTitle:"Edit Profile" });
    } 
    if(current.email !== email && emailChk._id !== _id) {
        req.flash("error", "Email is duplicated.");
        return res.render("editProfile", { pageTitle:"Edit Profile" });
    }
    const updatedUser = await User.findByIdAndUpdate(_id, {
        avatarUrl: file ? (isHeroku ? file.location : file.path ) : avatarUrl,
        name, email, nickName, location
    }, { new: true }); //업데이트 된 내용을 반환하기 위한 new
    
    req.session.user = updatedUser;  //db.만 업데이트하고 session은 업데이트된 상태가 아니므로 해줘야함.
    req.flash("success", "Success");
    return res.render("editProfile", { pageTitle:"Edit Profile" });
};

export const getChangePassword = (req, res) => {
    if(req.session.user.socialOnly === true) {
        req.flash("error", "Can't change password");
        return res.redirect("/");
    }
    return res.render("changePassword", { pageTitle:"Change Password" })
};

export const postChangePassword = async(req, res) => {
    const { 
        session: {
            user: { _id },
        },
        body: { oldPassword, newPassword, newPassword1 },
    } = req;
    const user = await User.findById(_id);
    const ok = await bcrypt.compare(oldPassword, user.password); //새로 해싱되지 않는 비번과 기존의 해싱된 비번을 비교해줌.

    if(!ok) {
        req.flash("error", "The current password is incorrect.");
        return res.status(400).render("changePassword", { pageTitle:"Change Password" });
    }
    if(newPassword !== newPassword1) {
        req.flash("error", "The password does not match the confirmation.");
        return res.status(400).render("changePassword", { pageTitle:"Change Password" });
    }
    
    user.password = newPassword;
    await user.save();
    return res.redirect("/users/logout")
};

export const nickChk = async(req, res) => {
    const {
        body: { text }
    } = req;

    const check = await User.exists({ nickName: text })
    return res.status(201).json({ check });
};

export const emailChk = async(req, res) => {
    const {
        body: { text }
    } = req;

    const check = await User.exists({ email: text })
    return res.status(201).json({ check });
};

export const sendEmail = async (req, res) => {
    const {
        body: { 
            toEmail: email, 
            randomCode 
        }
    } = req;
    req.session.emailCode[email] = randomCode;
    const transporter = nodemailer.createTransport({
        host: process.env.MAIL_HOST,
        auth: {
            user: process.env.MAIL_ID, 
            pass: process.env.MAIL_PW, 
        },
    });
    
    transporter.sendMail({
        from: `"puddingii-Youtube" <${process.env.MAIL_ID}@naver.com>`,
        to: email, 
        subject: "[puddingii-Youtube] Please verify this code.",
        text: `Code is ${randomCode}`,
    }, (err) => {
        if(err) {
            //req.flash("error", "Email send error.");
            res.sendStatus(400);
        } else {
            //req.flash("success", "Check your email. (~5minutes)")
            res.sendStatus(200);
        }
    });
};
